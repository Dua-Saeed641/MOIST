# What the glove tracks (for the dashboard)

This page covers what each reading contains, where each field comes from, and what the dashboard can show from it.
Hardware details are in [`../hardware.md`](../hardware.md).

## How a reading travels

```
Glove (Arduino)  --USB serial, 1 JSON line-->  Gateway (laptop/phone)  --HTTPS POST /readings-->  API + DB  --GET /readings-->  Dashboard
     sensor fields                           + timestamp, lat/lon, area_id          + id, class check, anomaly
```

A reading is created when the worker holds the glove at the right distance from one waste item. Each reading describes **one item**, not a whole bin.

## Fields

### From the glove (Arduino serial line)

| Field | Type | Meaning | Range / example |
|---|---|---|---|
| `device_id` | string | which glove | `"glove-01"` |
| `moisture_raw` | int | probe reading (median of 7 samples) | 0 to 1023, calibration-dependent |
| `moisture_slope` | int | change in the raw value during the 0.7 s of contact (helps the ML model) | about -200 to 200 |
| `moisture_score` | float | normalised wetness | **0 = dry … 1 = wet** |
| `class` | string | on-device verdict | `"wet"` / `"dry"` / `"uncertain"` (cut-offs 0.38 / 0.62, same as `web/src/config.ts`) |
| `air_temp_c` | float or null | air temperature | about 15 to 45 |
| `air_rh_pct` | float or null | air humidity | 20 to 95 |
| `gas_raw` | int or null | gas/aux sensor, if fitted | 0 to 1023, relative only |
| `distance_cm` | int | sonar distance at the moment of measurement | usually about 12 |

`null` means the sensor wasn't fitted or the read failed. Show it as "—", not as 0.
Lines starting with `#` are status messages, not readings. The gateway should skip them.

### Added by the gateway

| Field | Meaning |
|---|---|
| `timestamp` / `ts` | UTC time the reading arrived |
| `lat`, `lon` | phone GPS |
| `area_id` | collection point / colony picked by the worker (matches `Area.id`) |

### Added by the backend

| Field | Meaning |
|---|---|
| `id` | unique reading id |
| `class`, `moisture_score` | may be recomputed by the ML model instead of the on-device threshold |
| `anomaly` | true when the reading is unusual (for example, a sudden jump in moisture or gas) |

## What the dashboard already uses

`web/src/types.ts` → `Reading`, mapped in `web/src/data/http.ts`:

| Dashboard field | API field |
|---|---|
| `moistureRaw` | `moisture_raw` |
| `moistureScore` | `moisture_score` |
| `cls` | `class` |
| `anomaly` | `anomaly` |
| `airTempC` | `air_temp_c` |
| `airRhPct` | `air_rh_pct` |
| `deviceId`, `areaId`, `ts`, `id` | `device_id`, `area_id`, `ts`, `id` |

## New from the hardware (not in the dashboard yet)

| Field | Ideas for the dashboard |
|---|---|
| `gas_raw` | per-area average and trend. High gas together with wet means rotting organic waste, so flag it. Hide it if every value is null |
| `moisture_slope` | mostly for the ML model. Could appear in the reading detail view |
| `distance_cm` | quality check: readings far from the usual ~12 cm are less reliable. Could be shown as a small "confidence" indicator |

To add one, put it in `Reading` in `types.ts`, in `ApiReading` and `toReading` in `http.ts` (use `?? null`), and in `makeReading` in `data/sample.ts` so the simulated feed has it too.

## Metrics built from these (already in `web/src/lib/metrics.ts`)

- **Dry fraction** per area: share of readings classed dry.
- **Mean moisture** per area.
- **ESI** (Energy Suitability Index) = w1·(1 − mean moisture) + w2·dry fraction + w3·(1 − uncertain fraction).
- **Anomaly share**, and the **trend** (change in dry fraction over the selected range).
- Status colours, ranking and recommended actions are based on these.

## Testing without the glove

Leave `VITE_API_URL` empty in `web/.env`. The dashboard then uses the simulated feed in `web/src/data/sample.ts`, which produces the same fields.
