"""Demo data: creates collection points around Delhi and posts 30 days of SIMULATED checks.
Simulated gloves are named sim-*, and the dashboard labels them "simulated" so they are never confused with the real glove.

    python backend/seed.py                                  # local API
    python backend/seed.py --api https://xxx.execute-api.ap-south-1.amazonaws.com --key <WriteApiKey>
    python backend/seed.py --live                           # keep streaming a simulated check every few seconds
"""
import argparse
import json
import os
import random
import time
import urllib.request

AREAS = [  # id, name, ward, lat, lon, dry probability at day 0 and day 30, kind
    ("demo-bench", "Demo bench", "Lab", 28.6139, 77.2090, None, None, "collection_point"),  # the real glove posts here
    ("rohini-s9", "Rohini Sector 9", "Rohini", 28.7180, 77.1120, 0.66, 0.74, "collection_point"),
    ("dwarka-s6", "Dwarka Sector 6", "Dwarka", 28.5900, 77.0590, 0.58, 0.70, "collection_point"),
    ("okhla-tx", "Okhla Transfer Station", "Okhla", 28.5355, 77.2720, 0.47, 0.44, "transfer_station"),
    ("laxmi-nagar", "Laxmi Nagar", "Shahdara", 28.6304, 77.2773, 0.26, 0.21, "colony"),
    ("karol-bagh", "Karol Bagh Market", "Karol Bagh", 28.6519, 77.1909, 0.42, 0.31, "collection_point"),
    ("saket-j", "Saket Block J", "Saket", 28.5245, 77.2066, 0.71, 0.78, "colony"),
]
DAY = 86_400_000


def call(api, key, method, path, body):
    req = urllib.request.Request(api.rstrip("/") + path, data=json.dumps(body).encode(), method=method,
                                 headers={"content-type": "application/json", "x-api-key": key})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fake(area, p_dry, ts, glove):
    kind = "dry" if random.random() < p_dry else "wet" if random.random() < 0.85 else "unc"
    m = {"dry": random.uniform(0.0, 0.3), "wet": random.uniform(0.7, 1.0), "unc": random.uniform(0.4, 0.6)}[kind]
    if random.random() < 0.012:
        raw = random.randint(30, 200)  # metal shorting the probe -> anomaly
    else:
        raw = round(990 - m * 190 + random.uniform(-6, 6))
    return {"device_id": glove, "area_id": area, "timestamp": ts, "moisture_raw": max(0, min(1023, raw)),
            "moisture_score": round(m, 3), "moisture_slope": random.randint(-20, 20),
            "air_temp_c": round(random.uniform(24, 35), 1), "air_rh_pct": round(random.uniform(40, 75), 1),
            "gas_raw": None, "distance_cm": random.randint(10, 13)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=os.environ.get("MOIST_API", "http://localhost:8787"))
    ap.add_argument("--key", default=os.environ.get("MOIST_API_KEY", ""))
    ap.add_argument("--live", action="store_true", help="stream simulated checks instead of backfilling history")
    a = ap.parse_args()

    for aid, name, ward, lat, lon, *_, kind in AREAS:
        call(a.api, a.key, "PUT", f"/areas/{aid}", {"name": name, "ward": ward, "lat": lat, "lon": lon, "kind": kind})
    sim = [x for x in AREAS if x[5] is not None]

    if a.live:
        print("streaming simulated checks, Ctrl+C to stop")
        while True:
            x = random.choice(sim)
            print(call(a.api, a.key, "POST", "/readings", fake(x[0], x[6], int(time.time() * 1000), f"sim-{x[0]}")))
            time.sleep(random.uniform(2, 6))

    now = int(time.time() * 1000)
    rows = []
    for aid, _n, _w, _la, _lo, p0, p1, _k in sim:
        for d in range(30, 0, -1):
            p = p1 + (p0 - p1) * d / 30  # drifts from p0 (30 days ago) to p1 (today)
            for _ in range(random.randint(18, 40)):
                ts = now - d * DAY + random.randint(6, 18) * 3_600_000 + random.randint(0, 3_599_999)
                if ts < now:
                    rows.append(fake(aid, p, ts, f"sim-{aid}"))
    for i in range(0, len(rows), 500):
        call(a.api, a.key, "POST", "/readings", rows[i:i + 500])
    print(f"seeded {len(sim)} areas, {len(rows)} simulated checks")
