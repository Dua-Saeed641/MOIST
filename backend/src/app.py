"""MØIST API (one Lambda behind API Gateway HTTP API) + the daily brief job (EventBridge schedule).

  POST /readings          glove reading(s) from the gateway  (x-api-key)
  GET  /live?since=ms     newest checks + glove status, polled every 2 s by the dashboard
  GET  /overview?range=   KPIs, per-area stats + ESI + action, trend, latest brief
  GET  /areas/{id}        one area: stats, trend, recent checks
  PUT  /areas/{id}        create / update an area  (x-api-key)
  GET  /alerts?range=     unusual checks
  GET  /actions           PUT /actions/{key}   officer's action queue
  GET  /brief             POST /brief  regenerate the Bedrock brief
  POST /ask               free-text question about the data, answered by Claude on Bedrock
  GET  /gateway           laptop gateway status, fetched through its ngrok URL (GATEWAY_URL)
"""
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import unquote

import logic
from brief import ai_enabled, answer, make_brief
from store import DAY

HOUR = 3_600_000
RANGES = {"24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY}
ASK_PER_HOUR = int(os.environ.get("ASK_PER_HOUR", 60))
ACTION_STATES = ("open", "scheduled", "done")
AREA_KINDS = ("collection_point", "transfer_station", "colony")
NUMERIC = {"moisture_raw": (0, 1023), "moisture_slope": (-1023, 1023), "moisture_score": (0, 1), "air_temp_c": (-40, 85),
           "air_rh_pct": (0, 100), "gas_raw": (0, 1023), "distance_cm": (0, 1000)}

_store = None


def store():
    global _store
    if _store is None:
        from store import DynamoStore

        _store = DynamoStore()
    return _store


def set_store(s):
    global _store
    _store = s


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def now_ms():
    return int(time.time() * 1000)


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def require_key(event):
    expected = os.environ.get("WRITE_API_KEY")
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if expected and headers.get("x-api-key") != expected:
        raise ApiError(401, "Missing or invalid x-api-key")


def body_of(event):
    try:
        return json.loads(event.get("body") or "null")
    except ValueError:
        raise ApiError(400, "Body must be JSON")


def to_ms(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return int(v)
    if isinstance(v, str):
        try:
            return int(v) if v.isdigit() else int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            pass
    raise ApiError(400, "timestamp must be ISO-8601 or epoch ms")


# ---------- ingest ----------
def build_reading(b):
    if not isinstance(b, dict):
        raise ApiError(400, "Reading must be a JSON object")
    for f in ("device_id", "area_id"):
        if not isinstance(b.get(f), str) or not b[f] or len(b[f]) > 64:
            raise ApiError(400, f"{f} is required")
    for f, (lo, hi) in NUMERIC.items():
        v = b.get(f)
        if v is None and f == "moisture_raw":
            raise ApiError(400, "moisture_raw is required")
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi):
            raise ApiError(400, f"{f} must be a number between {lo} and {hi}")
    ts = to_ms(b["timestamp"]) if b.get("timestamp") is not None else now_ms()
    if ts > now_ms() + 5 * 60_000:
        raise ApiError(400, "timestamp is in the future")
    m = b["moisture_score"] if b.get("moisture_score") is not None else logic.score_of(b["moisture_raw"])
    r = {"id": f"{b['device_id']}-{ts}", "ts": ts, "device_id": b["device_id"], "area_id": b["area_id"],
         **{f: b[f] for f in NUMERIC if b.get(f) is not None},
         "moisture_score": round(m, 3), "class": logic.classify(m), "certainty": logic.certainty(m)}
    reason = logic.anomaly_reason(r)
    r["anomaly"] = reason is not None
    if reason:
        r["anomaly_reason"] = reason
    return r


def alert(r, area):
    topic = os.environ.get("ALERT_TOPIC_ARN")
    if not topic:
        return
    try:
        import boto3

        boto3.client("sns").publish(TopicArn=topic, Subject=f"MOIST alert: {area['name']}",
                                    Message=f"{r['anomaly_reason']} at {area['name']} ({iso(r['ts'])}), "
                                            f"glove {r['device_id']}, moisture {r['moisture_score']}.")
    except Exception as e:  # an alert must never lose the reading
        print(f"alert not sent: {e!r}")


def post_readings(q, event, **_):
    require_key(event)
    b = body_of(event)
    s = store()
    if isinstance(b, list):  # batch (gateway catch-up or seeding)
        if not 0 < len(b) <= 500:
            raise ApiError(400, "Batch must hold 1 to 500 readings")
        areas = {a["id"] for a in s.list_areas()}
        bad = {x.get("area_id") for x in b if isinstance(x, dict)} - areas
        if bad:
            raise ApiError(400, f"unknown area_id {sorted(map(str, bad))}")
        out = [build_reading(x) for x in b]
        s.put_readings(out)
        return 200, {"stored": len(out)}
    area = s.get_area(b.get("area_id")) if isinstance(b, dict) else None
    if not area:
        raise ApiError(400, "unknown area_id")
    r = build_reading(b)
    if s.put_reading(r) and r["anomaly"]:
        alert(r, area)
    return 200, {k: r.get(k) for k in ("id", "class", "moisture_score", "certainty", "anomaly", "anomaly_reason")}


# ---------- read side ----------
def window(q):
    span = RANGES.get(q.get("range", "7d"))
    if not span:
        raise ApiError(400, "range must be 24h, 7d or 30d")
    to = now_ms()
    return to - span, to, span


def area_views(areas, rows):
    by = {}
    for r in rows:
        by.setdefault(r["area_id"], []).append(r)
    out = []
    for a in areas:
        st = logic.summarize(by.get(a["id"], []))
        title, detail = logic.recommend(st)
        out.append({**a, "stats": st, "recommendation": {"type": st["status"], "title": title, "detail": detail}})
    for i, v in enumerate(sorted((v for v in out if v["stats"]["count"]), key=lambda v: -v["stats"]["esi"]), 1):
        v["rank"] = i
    return out


def kpis(rows, areas_v):
    total, rows = len(rows), [r for r in rows if not r.get("anomaly")]
    n = len(rows)
    rated = [a for a in areas_v if a["stats"]["count"]]
    return {"checks": total,
            "dryShare": round(sum(r["class"] == "dry" for r in rows) / n, 4) if n else 0,
            "wetShare": round(sum(r["class"] == "wet" for r in rows) / n, 4) if n else 0,
            "meanMoisture": round(sum(r["moisture_score"] for r in rows) / n, 4) if n else 0,
            "esi": round(sum(a["stats"]["esi"] * a["stats"]["count"] for a in rated) / sum(a["stats"]["count"] for a in rated), 1) if rated else 0,
            "anomalies": total - n,
            "gloves": len({r["device_id"] for r in rows}),
            "areas": len(rated)}


def get_overview(q, **_):
    frm, to, span = window(q)
    s = store()
    rows = s.readings_between(frm - span, to)  # this period + the one before, for the deltas
    cur, prev = [r for r in rows if r["ts"] >= frm], [r for r in rows if r["ts"] < frm]
    areas = s.list_areas()
    views = area_views(areas, cur)
    return 200, {"range": q.get("range", "7d"), "from": frm, "to": to, "kpis": kpis(cur, views),
                 "previous": kpis(prev, area_views(areas, prev)), "areas": views,
                 "trend": logic.buckets(cur, frm, to, HOUR if span == DAY else DAY),
                 "brief": s.get_state("brief", "latest")}


def get_live(q, **_):
    to = now_ms()
    since = int(q.get("since") or 0)
    rows = store().readings_between(to - DAY, to)
    devices = {}
    for r in rows:
        d = devices.setdefault(r["device_id"], {"id": r["device_id"], "today": 0})
        d.update(last_seen=r["ts"], area_id=r["area_id"])
        d["today"] += 1
    new = [r for r in rows if r["ts"] > since][-50:]
    return 200, {"now": to, "readings": new[::-1], "devices": sorted(devices.values(), key=lambda d: -d["last_seen"]),
                 "today": kpis(rows, [])}


def get_area(q, area_id, **_):
    frm, to, span = window(q)
    s = store()
    area = s.get_area(area_id)
    if not area:
        raise ApiError(404, "Area not found")
    rows = s.readings_between(frm, to, area_id)
    view = area_views([area], rows)[0]
    return 200, {**view, "trend": logic.buckets(rows, frm, to, HOUR if span == DAY else DAY), "recent": rows[-25:][::-1]}


def put_area(q, area_id, event, **_):
    require_key(event)
    b = body_of(event) or {}
    if not re.fullmatch(r"[a-z0-9-]{2,40}", area_id):
        raise ApiError(400, "area id: 2-40 lowercase letters, digits or dashes")
    if not isinstance(b.get("name"), str) or not b["name"].strip():
        raise ApiError(400, "name is required")
    for f, lim in (("lat", 90), ("lon", 180)):
        if isinstance(b.get(f), bool) or not isinstance(b.get(f), (int, float)) or abs(b[f]) > lim:
            raise ApiError(400, f"{f} must be a number within ±{lim}")
    kind = b.get("kind", "collection_point")
    if kind not in AREA_KINDS:
        raise ApiError(400, f"kind must be one of {', '.join(AREA_KINDS)}")
    a = {"id": area_id, "name": b["name"].strip()[:80], "ward": str(b.get("ward") or "")[:40], "kind": kind,
         "lat": b["lat"], "lon": b["lon"]}
    store().put_area(a)
    return 200, a


def get_alerts(q, **_):
    frm, to, _ = window(q)
    s = store()
    names = {a["id"]: a["name"] for a in s.list_areas()}
    rows = [{**r, "area_name": names.get(r["area_id"], r["area_id"])} for r in s.readings_between(frm, to) if r.get("anomaly")]
    return 200, {"alerts": rows[::-1][:200]}


def get_actions(q, **_):
    return 200, {"actions": {i["key"]: i["state"] for i in store().list_state("action")}}


def put_action(q, key, event, **_):
    # ponytail: open to the dashboard (no login); add Cognito before giving the URL to more than the team
    state = (body_of(event) or {}).get("state")
    if state not in ACTION_STATES or len(key) > 100:
        raise ApiError(400, f"state must be one of {', '.join(ACTION_STATES)}")
    store().put_state("action", key, {"state": state, "updated": now_ms()})
    return 200, {"key": key, "state": state}


def refresh_brief(use_ai=True):
    s = store()
    to = now_ms()
    views = area_views(s.list_areas(), s.readings_between(to - 7 * DAY, to))
    b = {**make_brief(views, use_ai), "generated": to}
    s.put_state("brief", "latest", b)
    return b


def get_brief(q, **_):
    return 200, store().get_state("brief", "latest") or refresh_brief(use_ai=False)


def post_brief(q, **_):
    last = store().get_state("brief", "latest")
    if last and last.get("source") == "bedrock" and now_ms() - last["generated"] < 60_000:
        return 200, last  # cool-down: one Bedrock call per minute at most
    return 200, refresh_brief()


def post_ask(q, event, **_):
    b = body_of(event) or {}
    question = b.get("question")
    if not isinstance(question, str) or not 3 <= len(question.strip()) <= 300:
        raise ApiError(400, "question must be 3 to 300 characters")
    if not ai_enabled():
        raise ApiError(503, "AI answers need Amazon Bedrock. They work once the backend runs on AWS.")
    # ponytail: hourly cap stops a public dashboard running up the Bedrock bill; per-user limits need Cognito
    hour = str(now_ms() // HOUR)
    used = (store().get_state("ask", hour) or {}).get("n", 0)
    if used >= ASK_PER_HOUR:
        raise ApiError(429, "Question limit for this hour reached. Try again later.")
    store().put_state("ask", hour, {"n": used + 1})
    frm, to, _ = window(b)
    views = area_views(store().list_areas(), store().readings_between(frm, to))
    try:
        text = answer(views, question.strip(), b.get("range", "7d"))
    except Exception as e:  # no model access, throttled, ...
        print(f"ask failed: {e!r}")
        raise ApiError(502, "Claude on Bedrock did not answer. Check model access in the Bedrock console.")
    return 200, {"question": question.strip(), "answer": text, "model": os.environ.get("BRIEF_MODEL", "anthropic.claude-opus-5-5"),
                 "generated": now_ms()}


def get_gateway(q, **_):
    """Status of the laptop gateway, read through its ngrok tunnel. Shows whether the glove is plugged in right now."""
    url = os.environ.get("GATEWAY_URL", "").rstrip("/")
    if not url:
        return 200, {"configured": False}
    import urllib.request

    req = urllib.request.Request(url + "/status", headers={"x-gateway-token": os.environ.get("GATEWAY_TOKEN", ""),
                                                           "ngrok-skip-browser-warning": "1"})
    try:
        with urllib.request.urlopen(req, timeout=4) as res:
            return 200, {"configured": True, "online": True, **json.loads(res.read())}
    except Exception as e:
        return 200, {"configured": True, "online": False, "error": str(e)[:120]}


ROUTES = [
    ("GET", r"/health", lambda q, **_: (200, {"ok": True, "now": now_ms()})),
    ("POST", r"/readings", post_readings),
    ("GET", r"/live", get_live),
    ("GET", r"/overview", get_overview),
    ("GET", r"/areas/(?P<area_id>[^/]+)", get_area),
    ("PUT", r"/areas/(?P<area_id>[^/]+)", put_area),
    ("GET", r"/alerts", get_alerts),
    ("GET", r"/actions", get_actions),
    ("PUT", r"/actions/(?P<key>[^/]+)", put_action),
    ("GET", r"/brief", get_brief),
    ("POST", r"/brief", post_brief),
    ("POST", r"/ask", post_ask),
    ("GET", r"/gateway", get_gateway),
]

HEADERS = {"content-type": "application/json", "access-control-allow-origin": "*",
           "access-control-allow-headers": "content-type,x-api-key", "access-control-allow-methods": "GET,POST,PUT,OPTIONS"}


def respond(status, body):
    return {"statusCode": status, "headers": HEADERS, "body": json.dumps(body)}


def handler(event, _context=None):
    if "requestContext" not in event:  # EventBridge schedule: the morning brief
        b = refresh_brief()
        topic = os.environ.get("BRIEF_TOPIC_ARN")
        if topic:
            import boto3

            boto3.client("sns").publish(TopicArn=topic, Subject="MOIST morning brief", Message=b["text"])
        return b
    method = event["requestContext"].get("http", {}).get("method", "GET")
    path = (event.get("rawPath") or "/").rstrip("/") or "/"
    if method == "OPTIONS":
        return respond(204, {})
    try:
        for m, pattern, fn in ROUTES:
            hit = re.fullmatch(pattern, path)
            if m == method and hit:
                params = {k: unquote(v) for k, v in hit.groupdict().items()}
                return respond(*fn(event.get("queryStringParameters") or {}, event=event, **params))
        raise ApiError(404, "Not found")
    except ApiError as e:
        return respond(e.status, {"error": e.message})
    except Exception as e:  # noqa: BLE001
        print(f"error on {method} {path}: {e!r}")
        return respond(500, {"error": "Internal error"})
