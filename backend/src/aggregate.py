"""Nightly EventBridge job (report section 11, step 6).

Live counters are already maintained at ingest time; this recomputes them from the raw readings for the
last two days to repair any drift (retries, partial failures) and refreshes the per-day cluster label."""
from common import get_store, now_ms
from logic import cluster_label
from store import day_of

DAY = 86400000


def recompute_day(store, date_ms):
    day_start = date_ms - (date_ms % DAY)
    rs = store.query_readings(day_start, day_start + DAY - 1, limit=20000)
    per = {}
    for r in rs:
        a = per.setdefault(r["area_id"], {"count": 0, "dry": 0, "unc": 0, "anomalies": 0, "sum_m": 0.0})
        a["count"] += 1
        a["dry"] += r["class"] == "dry"
        a["unc"] += r["class"] == "uncertain"
        a["anomalies"] += bool(r["anomaly"])
        a["sum_m"] += r["moisture_score"]
    for area_id, row in per.items():
        row["sum_m"] = round(row["sum_m"], 4)
        row["cluster"] = cluster_label(row["sum_m"] / row["count"], row["dry"] / row["count"])
        store.set_stats(area_id, day_of(day_start), row)
    return len(per)


def handler(event=None, _context=None):
    store, now = get_store(), now_ms()
    n = sum(recompute_day(store, now - d * DAY) for d in (0, 1))
    return {"areas_updated": n}
