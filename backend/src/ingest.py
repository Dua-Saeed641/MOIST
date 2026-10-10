"""POST /readings and POST /readings/batch -- validate, classify, score, flag anomalies, store, update live stats."""
import os

from common import ApiError, get_store, iso, now_ms, parse_body, require_key, respond, to_ms
from logic import is_anomaly, moisture_score, predict_class
from model import load_model
from store import day_of

_sns = None


def send_alert(reading):
    """Optional SNS e-mail/SMS alert (report section 10.1). No-op unless ALERT_TOPIC_ARN is set. Never breaks ingest."""
    topic = os.environ.get("ALERT_TOPIC_ARN")
    if not topic:
        return
    global _sns
    try:
        if _sns is None:
            import boto3

            _sns = boto3.client("sns")
        _sns.publish(
            TopicArn=topic,
            Subject="MOIST: unusual reading",
            Message=f"Unusual reading at {reading['area_id']} ({reading['timestamp']}): wetness {reading['moisture_score']}, "
                    f"gas {reading.get('gas_raw', 'n/a')}. Please inspect.",
        )
    except Exception as exc:  # noqa: BLE001
        print(f"alert not sent: {exc!r}")

NUMERIC = {
    "moisture_raw": (0, 1023, True),
    "moisture_slope": (-1023, 1023, False),
    "air_temp_c": (-40, 85, False),
    "air_rh_pct": (0, 100, False),
    "gas_raw": (0, 1023, False),
    "distance_cm": (0, 1000, False),  # sonar distance when the glove measured (quality hint)
    "lat": (-90, 90, False),
    "lon": (-180, 180, False),
}


def validate(body):
    if not isinstance(body, dict):
        raise ApiError(400, "Reading must be a JSON object")
    errors = []
    for f in ("device_id", "area_id", "timestamp"):
        if not body.get(f):
            errors.append(f"{f} is required")
    for f, (lo, hi, required) in NUMERIC.items():
        v = body.get(f)
        if v is None:
            if required:
                errors.append(f"{f} is required")
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
            errors.append(f"{f} must be a number between {lo} and {hi}")
    if errors:
        raise ApiError(400, "Invalid reading", errors)
    ts = to_ms(body["timestamp"])
    if ts > now_ms() + 5 * 60 * 1000:
        raise ApiError(400, "Invalid reading", ["timestamp is in the future"])
    return ts


def ingest_one(store, body):
    ts = validate(body)
    if not store.get_area(body["area_id"]):
        raise ApiError(400, "Invalid reading", [f"unknown area_id '{body['area_id']}'"])
    model = load_model()
    m = moisture_score(body["moisture_raw"], model)
    cls, confidence = predict_class(body, m, model)
    anomaly = is_anomaly(m, body.get("gas_raw"), store.recent_scores(body["area_id"]), model)
    reading = {
        "id": f"{body['device_id']}-{ts}",
        "ts": ts,
        "timestamp": iso(ts),
        **{k: body[k] for k in ("device_id", "area_id", "moisture_raw")},
        **{k: body[k] for k in NUMERIC if k != "moisture_raw" and body.get(k) is not None},
        # Basic worker tracking as agreed: an opaque id only, no names.
        **({"worker_id": str(body["worker_id"])} if body.get("worker_id") else {}),
        "moisture_score": m,
        "class": cls,
        "anomaly": anomaly,
        **({"confidence": confidence} if confidence is not None else {}),
    }
    if not store.put_reading(reading):  # already stored (a retry): do not count it twice
        return {**reading, "duplicate": True}
    store.add_stats(body["area_id"], day_of(ts), {"count": 1, "dry": int(cls == "dry"), "unc": int(cls == "uncertain"),
                                                  "anomalies": int(anomaly), "sum_m": m})
    if anomaly:
        send_alert(reading)
    return reading


def handler(event, _context=None):
    method = event.get("requestContext", {}).get("http", {}).get("method", "POST")
    if method == "OPTIONS":
        return respond(204, {})
    try:
        require_key(event)
        body = parse_body(event)
        store = get_store()
        path = event.get("rawPath", "/readings")
        if path.rstrip("/").endswith("/batch"):
            if not isinstance(body, list) or not 0 < len(body) <= 500:
                raise ApiError(400, "Batch must be a JSON array of 1 to 500 readings")
            # Oldest first, so anomaly detection sees the same history it would have seen live.
            ordered = sorted(body, key=lambda r: to_ms(r.get("timestamp", 0)) if isinstance(r, dict) else 0)
            ok, failed = [], []
            for i, r in enumerate(ordered):
                try:
                    ok.append(ingest_one(store, r))
                except ApiError as e:
                    failed.append({"index": i, "error": e.message, "details": e.details})
            return respond(207 if failed else 200, {"stored": len(ok), "failed": failed})
        r = ingest_one(store, body)
        return respond(200, {"class": r["class"], "moisture_score": r["moisture_score"], "anomaly": r["anomaly"], "id": r["id"],
                             **({"duplicate": True} if r.get("duplicate") else {})})
    except ApiError as e:
        return respond(e.status, {"error": e.message, **({"details": e.details} if e.details else {})})
    except Exception as e:  # noqa: BLE001
        print(f"ingest error: {e!r}")
        return respond(500, {"error": "Internal error"})

