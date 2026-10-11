"""Feature vector for the wet/dry classifier (report section 9.1).

This file is the single source of truth: ml/train.py imports it for training and the ingest Lambda
imports it for prediction, so the two can never drift apart. Keep it dependency-free.
"""

FEATURES = ["moisture_raw", "moisture_slope", "air_temp_c", "air_rh_pct", "rh_gap", "gas_raw"]


def build_features(r):
    """r: a reading dict (API field names). Missing optional sensors become 0 so the vector is always full."""
    raw = float(r["moisture_raw"])
    rh = float(r.get("air_rh_pct") or 0)
    # "difference between probe reading and ambient humidity": probe wetness (0..1, higher raw = drier) minus ambient RH (0..1)
    rh_gap = (1.0 - raw / 1023.0) - rh / 100.0
    return [
        raw,
        float(r.get("moisture_slope") or 0),
        float(r.get("air_temp_c") or 0),
        rh,
        rh_gap,
        float(r.get("gas_raw") or 0),
    ]
