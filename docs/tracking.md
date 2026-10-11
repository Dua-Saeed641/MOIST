# What the glove tracks, and the API the dashboard reads

Hardware details are in [`../hardware.md`](../hardware.md). How to run and deploy is in [`../README.md`](../README.md).

## How a check travels

```
Glove (Arduino) --USB serial, 1 JSON line--> gateway/gateway.py --POST /readings--> API Gateway -> Lambda -> DynamoDB
                                             + area_id, timestamp                    + class, certainty, anomaly
Dashboard (web/) <--GET /live every 2 s, /overview every 15 s-- Lambda
```

One check = one waste item. It is created when the worker holds the glove ~12 cm over an item and the servo arm taps it.

## Fields of one check

| Field | From | Meaning |
|---|---|---|
| `device_id` | glove | which glove (`glove-01`; simulated gloves are `sim-*`) |
| `moisture_raw` | glove | probe ADC value, median of 7 samples (dry ≈ 990, wet ≈ 800) |
| `moisture_slope` | glove | change during the 0.7 s of contact |
| `moisture_score` | glove | 0 = dry … 1 = wet (server computes it from raw if missing) |
| `air_temp_c`, `air_rh_pct` | glove | DHT11; absent when the read failed |
| `gas_raw` | glove | gas sensor, only if fitted |
| `distance_cm` | glove | sonar distance when the arm tapped (≈ 12) |
| `area_id`, `timestamp` → `ts` | gateway | where and when (epoch ms) |
| `id` | API | `device_id-ts`, so a retried upload is not stored twice |
| `class` | API | `dry` (score ≤ 0.38), `wet` (≥ 0.62), else `uncertain`. Same cut-offs as the glove |
| `certainty` | API | 0.5 on the fence … 1.0 at either end |
| `anomaly`, `anomaly_reason` | API | untrusted check: `Probe shorted (metal?)` when raw < 300, `High gas level` when gas > 600 |

Untrusted checks are counted, listed on **Alerts** and e-mailed through SNS, but kept out of dry share, moisture and ESI.

## Per-area numbers (backend/src/logic.py)

- **Dry share**, **mean moisture**, **unsure share** over the selected range (24h / 7d / 30d).
- **ESI** = 100 × (0.5·(1 − mean moisture) + 0.3·dry share + 0.2·(1 − unsure share)), from the report section 9.5.
- **Trend**: dry share in the second half of the range minus the first half.
- **Status** (needs ≥ 5 checks): `inspect` (≥ 8% untrusted) → `wet` (dry share < 30%) → `pickup` (ESI ≥ 70) → `watch` (≥ 4% untrusted or dry share fell ≥ 8 pts) → `ok`. Fewer checks = `idle`.
- Each status maps to one action (send to energy plant, segregation drive, inspection, watch).

## API

| Method | Path | Returns |
|---|---|---|
| POST | `/readings` | one check or a list of up to 500. Header `x-api-key`. Unknown `area_id` → 400 |
| GET | `/live?since=<ms>` | `{now, readings (newest first, max 50), devices, today}` |
| GET | `/overview?range=24h\|7d\|30d` | `{kpis, previous (same KPIs for the period before), areas[] with stats + recommendation + rank, trend[], brief}` |
| GET | `/areas/<id>?range=` | one area + `trend` + 25 `recent` checks |
| PUT | `/areas/<id>` | `{name, ward, kind, lat, lon}`. Header `x-api-key`. The gateway does this on start |
| GET | `/alerts?range=` | untrusted checks, newest first |
| GET / PUT | `/actions`, `/actions/<area_id>:<status>` | officer's action queue, `{state: open\|scheduled\|done}` |
| GET / POST | `/brief` | morning dispatch brief; POST regenerates (max once a minute) |

## The morning brief

`backend/src/brief.py` sends the per-area numbers (not raw checks) to Claude on Amazon Bedrock and asks for a short plain-text brief for the officer. The model only explains numbers we computed; it never decides a class. It runs every day at 06:30 IST (EventBridge Scheduler) and is e-mailed through SNS. Without Bedrock access it falls back to a rule-based brief, and the dashboard says which one you are reading.
