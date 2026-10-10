"""Pure business logic: classification, moisture score, anomaly check, ESI, status, recommendations.

Mirrors web/src/lib/metrics.ts and web/src/config.ts. Keep the two in sync.
"""
import math
import statistics

from features import build_features

DEFAULT_THRESHOLDS = {
    "blueDryMax": 0.3,
    "pickupEsiMin": 70,
    "anomalyAmber": 0.04,
    "anomalyRed": 0.08,
    "declineDelta": 0.08,
    "minReadings": 5,
}
DEFAULT_WEIGHTS = {"w1": 0.5, "w2": 0.3, "w3": 0.2}

# Calibration of the probe: raw ADC (higher = drier on most boards) -> moisture score M in [0, 1].
# Defaults match arduino/moist_glove (RAW_DRY=1000, RAW_WET=350) so the server and the glove agree until a real
# calibration run (report section 7.1) replaces them via model.json in S3. The formula works whichever way the board reads.
DEFAULT_MODEL = {"raw_dry": 1000, "raw_wet": 350, "dry_max": 0.38, "wet_min": 0.62, "gas_limit": 600}


def clamp01(x):
    return max(0.0, min(1.0, x))


def moisture_score(raw, model=DEFAULT_MODEL):
    span = model["raw_dry"] - model["raw_wet"]
    return round(clamp01((model["raw_dry"] - raw) / span), 3)


def classify(m, model=DEFAULT_MODEL):
    if m < model["dry_max"]:
        return "dry"
    if m > model["wet_min"]:
        return "wet"
    return "uncertain"


def _tree_proba(nodes, x):
    i = 0
    while "p" not in nodes[i]:
        n = nodes[i]
        i = n["l"] if x[n["f"]] <= n["t"] else n["r"]
    return nodes[i]["p"]


def predict_proba(spec, x):
    """Probability of each class in spec['classes'] for feature vector x. Supports the exports made by ml/train.py."""
    kind = spec["type"]
    if kind == "forest":
        probs = [_tree_proba(t, x) for t in spec["trees"]]
        return [sum(p[c] for p in probs) / len(probs) for c in range(len(spec["classes"]))]
    if kind == "logistic":
        z = sum(w * (v - mu) / sc for w, v, mu, sc in zip(spec["coef"], x, spec["mean"], spec["scale"])) + spec["intercept"]
        z = max(-30.0, min(30.0, z))
        p1 = 1 / (1 + math.exp(-z))
        return [1 - p1, p1]
    raise ValueError(f"unknown classifier type {kind}")


def predict_class(reading, m, model=DEFAULT_MODEL):
    """Final wet/dry/uncertain label for one reading, plus the confidence.

    Uses the trained classifier from model.json when present; low confidence becomes 'uncertain'
    (safer than forcing a wrong answer, report section 9.1). Falls back to the moisture-score bands."""
    spec = model.get("classifier")
    if not spec:
        return classify(m, model), None
    probs = predict_proba(spec, build_features(reading))
    best = max(range(len(probs)), key=lambda i: probs[i])
    if probs[best] < model.get("confidence", 0.7):
        return "uncertain", round(probs[best], 3)
    return spec["classes"][best], round(probs[best], 3)


def is_anomaly(m, gas_raw, recent_scores, model=DEFAULT_MODEL):
    """Rule-based stand-in for the Isolation Forest in the report (section 9.3).

    Flags a reading that is far from the area's recent behaviour (robust z-score on M)
    or whose gas level is above the limit. Swap for a trained model later; the API is unchanged.
    """
    if gas_raw is not None and gas_raw > model["gas_limit"]:
        return True
    if len(recent_scores) < 8:
        return False
    med = statistics.median(recent_scores)
    mad = statistics.median(abs(x - med) for x in recent_scores)
    dev = abs(m - med)
    return dev > 0.35 and dev / (1.4826 * mad + 0.05) > 3.5


def esi_of(mean_m, f_dry, f_unc, w):
    return 100 * (w["w1"] * (1 - mean_m) + w["w2"] * f_dry + w["w3"] * (1 - f_unc))


def validate_config(t, w):
    errs = []
    if not (0 < t["blueDryMax"] < 1):
        errs.append("blueDryMax must be between 0 and 1")
    if not (0 < t["pickupEsiMin"] <= 100):
        errs.append("pickupEsiMin must be between 0 and 100")
    if not (0 <= t["anomalyAmber"] < t["anomalyRed"] <= 1):
        errs.append("anomalyAmber must be lower than anomalyRed, both within 0 and 1")
    if not (0 < t["declineDelta"] < 1):
        errs.append("declineDelta must be between 0 and 1")
    if t["minReadings"] < 1:
        errs.append("minReadings must be at least 1")
    if any(w[k] < 0 or w[k] > 1 for k in ("w1", "w2", "w3")):
        errs.append("weights must each be between 0 and 1")
    if abs(w["w1"] + w["w2"] + w["w3"] - 1) > 0.001:
        errs.append("weights must sum to 1")
    return errs


def _pct(x):
    return f"{round(x * 100)}%"


def recommend(status, dry, esi, anomaly, t):
    if status == "red":
        return {"type": "inspection", "title": "Dispatch an inspection",
                "detail": f"Unusual moisture or gas spikes in {_pct(anomaly)} of loads. Check for contamination, "
                          "metal shorting the probe, or a faulty glove before routing this waste."}
    if status == "blue":
        return {"type": "campaign", "title": "Plan a segregation awareness drive",
                "detail": f"Only {_pct(dry)} of readings are dry. Wet waste is dominating, so this area's output "
                          "is unsuitable for energy recovery until segregation improves."}
    if status == "amber" and esi >= t["pickupEsiMin"]:
        return {"type": "pickup", "title": "Schedule direct dry-waste pickup",
                "detail": f"ESI {esi:.0f} with {_pct(dry)} dry readings. Route this load straight to the energy plant."}
    if status == "amber":
        return {"type": "monitor", "title": "Monitor closely",
                "detail": "Segregation quality is slipping or anomalies are creeping up. Re-check at the next collection round."}
    return {"type": "none", "title": "No action needed", "detail": "Readings are within normal range. Keep monitoring."}


def cluster_label(mean_m, f_dry):
    if f_dry >= 0.6 and mean_m <= 0.45:
        return "high-dry"
    if f_dry < 0.3:
        return "mostly-wet"
    return "mixed"


def summarize(rows, t, w):
    """rows: daily AreaStats items for ONE area, sorted by date.
    Each has count, dry, unc, anomalies, sum_m (all additive, so any date range re-aggregates exactly)."""
    n = sum(r["count"] for r in rows)
    if n == 0:
        return {"count": 0, "dryFraction": 0, "uncertainFraction": 0, "meanMoisture": 0, "esi": 0,
                "anomalyShare": 0, "trendDelta": 0, "status": "green", "clusterLabel": None}
    dry = sum(r["dry"] for r in rows)
    unc = sum(r["unc"] for r in rows)
    anom = sum(r["anomalies"] for r in rows)
    mean_m = sum(r["sum_m"] for r in rows) / n
    f_dry, f_unc, a = dry / n, unc / n, anom / n
    half = len(rows) // 2
    first, second = rows[:half], rows[half:]
    n1, n2 = sum(r["count"] for r in first), sum(r["count"] for r in second)
    trend = (sum(r["dry"] for r in second) / n2 - sum(r["dry"] for r in first) / n1) if n1 and n2 else 0
    esi = esi_of(mean_m, f_dry, f_unc, w)

    status = "green"
    if n >= t["minReadings"]:
        if a >= t["anomalyRed"]:
            status = "red"
        elif f_dry < t["blueDryMax"]:
            status = "blue"
        elif a >= t["anomalyAmber"] or esi >= t["pickupEsiMin"] or trend <= -t["declineDelta"]:
            status = "amber"
    return {"count": n, "dryFraction": round(f_dry, 4), "uncertainFraction": round(f_unc, 4),
            "meanMoisture": round(mean_m, 4), "esi": round(esi, 2), "anomalyShare": round(a, 4),
            "trendDelta": round(trend, 4), "status": status, "clusterLabel": cluster_label(mean_m, f_dry)}
