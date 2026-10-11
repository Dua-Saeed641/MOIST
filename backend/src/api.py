"""Read/query API for the dashboard: areas, readings, insights, actions, config."""
import re
from urllib.parse import unquote

from common import ApiError, get_config, get_store, iso, now_ms, parse_body, require_key, respond, to_ms
from logic import recommend, summarize, validate_config
from store import day_of

DAY = 86400000
ACTION_STATES = ("open", "scheduled", "done")
# What a map pin is. The glove is used at collection points / transfer stations, not at individual houses.
AREA_KINDS = ("collection_point", "transfer_station", "colony")


def _range(q):
    to = to_ms(q["to"], "to") if q.get("to") else now_ms()
    frm = to_ms(q["from"], "from") if q.get("from") else to - 7 * DAY
    if frm > to:
        raise ApiError(400, "'from' must be before 'to'")
    if to - frm > 92 * DAY:
        raise ApiError(400, "Range too large (max 92 days)")
    return frm, to


def _area_view(area, rows, t, w):
    s = summarize(rows, t, w)
    rec = recommend(s["status"], s["dryFraction"], s["esi"], s["anomalyShare"], t)
    return {"id": area["id"], "name": area["name"], "ward": area.get("ward"), "kind": area.get("kind", "collection_point"),
            "lat": area["lat"], "lon": area["lon"], "stats": s, "recommendation": rec}


def _all_areas(store, frm, to):
    t, w = get_config(store)
    stats = store.get_stats(day_of(frm), day_of(to))
    out = [_area_view(a, stats.get(a["id"], []), t, w) for a in store.list_areas()]
    for rank, a in enumerate(sorted(out, key=lambda a: -a["stats"]["esi"]), 1):
        a["rankAll"] = rank
    return out, t, w


def get_areas(store, q, **_):
    frm, to = _range(q)
    areas, _, _ = _all_areas(store, frm, to)
    return 200, {"from": iso(frm), "to": iso(to), "granularity": "day", "areas": areas}


def get_area(store, q, area_id, **_):
    frm, to = _range(q)
    area = store.get_area(area_id)
    if not area:
        raise ApiError(404, "Area not found")
    areas, t, w = _all_areas(store, frm, to)
    view = next(a for a in areas if a["id"] == area_id)
    rows = store.get_stats(day_of(frm), day_of(to)).get(area_id, [])
    trend = [{"date": r["date"], "count": r["count"], "dryFraction": round(r["dry"] / r["count"], 4) if r["count"] else None,
              "meanMoisture": round(r["sum_m"] / r["count"], 4) if r["count"] else None} for r in rows]
    return 200, {**view, "trend": trend}


def put_area(store, q, area_id, event, **_):
    require_key(event)
    b = parse_body(event)
    errs = []
    if not b.get("name"):
        errs.append("name is required")
    for f, lo, hi in (("lat", -90, 90), ("lon", -180, 180)):
        if not isinstance(b.get(f), (int, float)) or isinstance(b.get(f), bool) or not lo <= b[f] <= hi:
            errs.append(f"{f} must be a number between {lo} and {hi}")
    kind = b.get("kind", "collection_point")
    if kind not in AREA_KINDS:
        errs.append(f"kind must be one of {', '.join(AREA_KINDS)}")
    if errs:
        raise ApiError(400, "Invalid area", errs)
    area = {"id": area_id, "name": b["name"], "ward": b.get("ward"), "kind": kind, "lat": b["lat"], "lon": b["lon"]}
    store.put_area(area)
    return 200, area


def get_readings(store, q, **_):
    frm, to = _range(q)
    limit = min(int(q.get("limit", 5000)), 20000)
    rs = store.query_readings(frm, to, q.get("area_id"), limit)
    return 200, {"from": iso(frm), "to": iso(to), "count": len(rs), "readings": rs}


def get_insights(store, q, **_):
    frm, to = _range(q)
    areas, _, _ = _all_areas(store, frm, to)
    groups = {"inspection": [], "pickup": [], "campaign": [], "monitor": []}
    for a in sorted(areas, key=lambda a: -a["stats"]["esi"]):
        t = a["recommendation"]["type"]
        if t in groups:
            groups[t].append({"area_id": a["id"], "name": a["name"], "esi": a["stats"]["esi"], "detail": a["recommendation"]["detail"]})
    names = lambda k: ", ".join(x["name"] for x in groups[k][:3]) or "none"  # noqa: E731
    summary = (f"Dry-waste pickup: {names('pickup')}. Awareness drives: {names('campaign')}. "
               f"Inspections: {names('inspection')}.")
    # Rule-based today. A Bedrock call can rewrite `summary` later; it must only explain these numbers.
    return 200, {"generated": iso(now_ms()), "source": "rules", "summary": summary, **groups}


def get_actions(store, q, **_):
    return 200, {"actions": {i["key"]: i["state"] for i in store.list_state("action")}}


def put_action(store, q, key, event, **_):
    require_key(event)
    state = parse_body(event).get("state")
    if state not in ACTION_STATES:
        raise ApiError(400, f"state must be one of {', '.join(ACTION_STATES)}")
    store.put_state("action", key, {"state": state, "updated": iso(now_ms())})
    return 200, {"key": key, "state": state}


def get_config_route(store, q, **_):
    t, w = get_config(store)
    return 200, {"thresholds": t, "weights": w}


def put_config(store, q, event, **_):
    require_key(event)
    b = parse_body(event)
    cur_t, cur_w = get_config(store)
    t, w = {**cur_t, **b.get("thresholds", {})}, {**cur_w, **b.get("weights", {})}
    try:
        errs = validate_config(t, w)
    except (TypeError, KeyError):
        errs = ["thresholds and weights must be numeric"]
    if errs:
        raise ApiError(400, "Invalid config", errs)
    store.put_state("config", "current", {"thresholds": t, "weights": w})
    return 200, {"thresholds": t, "weights": w}


ROUTES = [
    ("GET", r"/health", lambda store, q, **_: (200, {"ok": True})),
    ("GET", r"/areas", get_areas),
    ("GET", r"/areas/(?P<area_id>[^/]+)", get_area),
    ("PUT", r"/areas/(?P<area_id>[^/]+)", put_area),
    ("GET", r"/readings", get_readings),
    ("GET", r"/insights", get_insights),
    ("GET", r"/actions", get_actions),
    ("PUT", r"/actions/(?P<key>.+)", put_action),
    ("GET", r"/config", get_config_route),
    ("PUT", r"/config", put_config),
]


def handler(event, _context=None):
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = (event.get("rawPath") or "/").rstrip("/") or "/"
    if method == "OPTIONS":
        return respond(204, {})
    try:
        for m, pattern, fn in ROUTES:
            match = re.fullmatch(pattern, path)
            if m == method and match:
                params = {k: unquote(v) for k, v in match.groupdict().items()}
                status, body = fn(get_store(), event.get("queryStringParameters") or {}, event=event, **params)
                return respond(status, body)
        raise ApiError(404, "Not found")
    except ApiError as e:
        return respond(e.status, {"error": e.message, **({"details": e.details} if e.details else {})})
    except ValueError as e:
        return respond(400, {"error": str(e)})
    except Exception as e:  # noqa: BLE001
        print(f"api error: {e!r}")
        return respond(500, {"error": "Internal error"})
