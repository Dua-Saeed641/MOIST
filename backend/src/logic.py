"""Pure logic: moisture score, class, anomaly check, per-area stats, Energy Suitability Index, recommendations.
No AWS imports here, so it runs the same in Lambda, locally and in tests."""
# Same numbers as arduino/moist_glove (RAW_DRY, RAW_WET, DRY_MAX, WET_MIN). Used only when the glove sends no score.
RAW_DRY, RAW_WET = 990, 800
DRY_MAX, WET_MIN = 0.38, 0.62
SHORTED_RAW = 300  # far below any wet reading (~650+): metal is shorting the probe
GAS_LIMIT = 600

W = {"w1": 0.5, "w2": 0.3, "w3": 0.2}  # ESI weights from the report (section 9.5)
MIN_READINGS = 5  # an area needs this many checks before it gets a status
PICKUP_ESI = 70
WET_AREA_DRY_MAX = 0.3
ANOMALY_AMBER, ANOMALY_RED = 0.04, 0.08


def clamp01(x):
    return max(0.0, min(1.0, x))


def score_of(raw):
    return round(clamp01((raw - RAW_DRY) / (RAW_WET - RAW_DRY)), 3)


def classify(m):
    return "dry" if m <= DRY_MAX else "wet" if m >= WET_MIN else "uncertain"


def certainty(m):
    """0.5 on the fence .. 1.0 at either end of the scale."""
    return round(0.5 + abs(m - 0.5), 3)


def anomaly_reason(r):
    """Why this reading can't be trusted, or None."""
    if r["moisture_raw"] < SHORTED_RAW:
        return "Probe shorted (metal?)"
    if (r.get("gas_raw") or 0) > GAS_LIMIT:
        return "High gas level"
    return None


def esi(mean_m, f_dry, f_unc):
    return 100 * (W["w1"] * (1 - mean_m) + W["w2"] * f_dry + W["w3"] * (1 - f_unc))


def summarize(rows):
    """rows: readings of ONE area, oldest first. Untrusted (anomaly) checks are counted but kept out of the shares."""
    anom = sum(bool(r.get("anomaly")) for r in rows)
    total, rows = len(rows), [r for r in rows if not r.get("anomaly")]
    n = len(rows)
    if not n:
        return {"count": 0, "dry": 0, "wet": 0, "uncertain": 0, "dryShare": 0, "meanMoisture": 0, "esi": 0,
                "anomalies": anom, "anomalyShare": 1 if total else 0, "trend": 0, "status": "idle"}
    c = {k: sum(r["class"] == k for r in rows) for k in ("dry", "wet", "uncertain")}
    mean_m = sum(r["moisture_score"] for r in rows) / n
    f_dry, f_unc, a = c["dry"] / n, c["uncertain"] / n, anom / total
    half = rows[: n // 2], rows[n // 2:]
    trend = (sum(r["class"] == "dry" for r in half[1]) / len(half[1]) - sum(r["class"] == "dry" for r in half[0]) / len(half[0])
             if half[0] else 0)
    e = esi(mean_m, f_dry, f_unc)
    status = "idle"
    if n >= MIN_READINGS:
        status = ("inspect" if a >= ANOMALY_RED else "wet" if f_dry < WET_AREA_DRY_MAX
                  else "pickup" if e >= PICKUP_ESI else "watch" if a >= ANOMALY_AMBER or trend <= -0.08 else "ok")
    return {"count": total, **c, "dryShare": round(f_dry, 4), "meanMoisture": round(mean_m, 4), "esi": round(e, 1),
            "anomalies": anom, "anomalyShare": round(a, 4), "trend": round(trend, 4), "status": status}


def pct(x):
    return f"{round(x * 100)}%"


def recommend(s):
    """One action per area, from its stats."""
    return {
        "inspect": ("Inspect the collection point", f"{pct(s['anomalyShare'])} of readings were excluded. Check the glove probe and the load for metal or contamination."),
        "wet": ("Run a segregation drive", f"Only {pct(s['dryShare'])} of items were dry. Output is not suitable for energy recovery until source segregation improves."),
        "pickup": ("Schedule direct transport to the energy plant", f"ESI {s['esi']:.0f}, {pct(s['dryShare'])} dry. Suitable as refuse-derived-fuel feedstock."),
        "watch": ("Monitor", "Dry share is falling or excluded readings are rising. Review at the next collection."),
        "ok": ("No action", "Within normal range."),
        "idle": ("Not enough readings", f"At least {MIN_READINGS} readings are needed for a rating."),
    }[s["status"]]


def buckets(rows, start, end, step):
    """Time series of checks, dry share and mean moisture."""
    n = max(1, -(-(end - start) // step))
    acc = [{"t": start + i * step, "count": 0, "dry": 0, "wet": 0, "sum_m": 0.0} for i in range(n)]
    for r in rows:
        if start <= r["ts"] <= end and not r.get("anomaly"):
            b = acc[min(n - 1, (r["ts"] - start) // step)]
            b["count"] += 1
            b["dry"] += r["class"] == "dry"
            b["wet"] += r["class"] == "wet"
            b["sum_m"] += r["moisture_score"]
    return [{"t": b["t"], "count": b["count"], "dry": b["dry"], "wet": b["wet"],
             "dryShare": round(b["dry"] / b["count"], 3) if b["count"] else None,
             "meanMoisture": round(b["sum_m"] / b["count"], 3) if b["count"] else None} for b in acc]
