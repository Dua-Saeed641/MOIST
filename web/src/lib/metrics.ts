import { CLASS_CUTOFFS, EsiWeights, Thresholds } from "../config";
import type { Area, AreaMetrics, QueueItem, Reading, Recommendation, Status, WasteClass } from "../types";

export function classify(m: number): WasteClass {
  return m < CLASS_CUTOFFS.dryMax ? "dry" : m > CLASS_CUTOFFS.wetMin ? "wet" : "uncertain";
}

/** ESI = 100 * (w1 (1 - M) + w2 f_dry + w3 (1 - f_unc)) -- report section 9.5. */
export function esiOf(meanM: number, fDry: number, fUnc: number, w: EsiWeights): number {
  return 100 * (w.w1 * (1 - meanM) + w.w2 * fDry + w.w3 * (1 - fUnc));
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

function recommend(
  status: Status,
  m: { dryFraction: number; esi: number; anomalyShare: number; trendDelta: number },
  t: Thresholds,
): { rec: Recommendation; reasons: string[] } {
  const reasons: string[] = [];
  if (m.anomalyShare >= t.anomalyAmber) reasons.push(`${pct(m.anomalyShare)} of readings flagged anomalous`);
  if (m.dryFraction < t.blueDryMax) reasons.push(`Dry fraction ${pct(m.dryFraction)} (wet-dominant)`);
  if (m.esi >= t.pickupEsiMin) reasons.push(`ESI ${m.esi.toFixed(0)} meets pickup threshold`);
  if (m.trendDelta <= -t.declineDelta) reasons.push(`Dry fraction fell ${pct(-m.trendDelta)} over the range`);

  if (status === "red")
    return {
      reasons,
      rec: {
        type: "inspection",
        title: "Dispatch an inspection",
        detail: `Unusual moisture or gas spikes in ${pct(m.anomalyShare)} of loads. Check for contamination, metal shorting the probe, or a faulty glove before routing this waste.`,
      },
    };
  if (status === "blue")
    return {
      reasons,
      rec: {
        type: "campaign",
        title: "Plan a segregation awareness drive",
        detail: `Only ${pct(m.dryFraction)} of readings are dry. Wet waste is dominating, so this area's output is unsuitable for energy recovery until segregation improves.`,
      },
    };
  if (status === "amber" && m.esi >= t.pickupEsiMin)
    return {
      reasons,
      rec: {
        type: "pickup",
        title: "Schedule direct dry-waste pickup",
        detail: `ESI ${m.esi.toFixed(0)} with ${pct(m.dryFraction)} dry readings. Route this load straight to the energy plant.`,
      },
    };
  if (status === "amber")
    return {
      reasons,
      rec: {
        type: "monitor",
        title: "Monitor closely",
        detail: "Segregation quality is slipping or anomalies are creeping up. Re-check at the next collection round.",
      },
    };
  return {
    reasons: reasons.length ? reasons : ["Within normal range"],
    rec: { type: "none", title: "No action needed", detail: "Readings are within normal range. Keep monitoring." },
  };
}

export function computeMetrics(
  areas: Area[],
  readings: Reading[],
  start: number,
  end: number,
  t: Thresholds,
  w: EsiWeights,
): AreaMetrics[] {
  const mid = (start + end) / 2;
  const byArea = new Map<string, Reading[]>();
  for (const r of readings) {
    if (r.ts < start || r.ts > end) continue;
    const list = byArea.get(r.areaId);
    if (list) list.push(r);
    else byArea.set(r.areaId, [r]);
  }

  const out: AreaMetrics[] = areas.map((area) => {
    const rs = byArea.get(area.id) ?? [];
    const n = rs.length;
    let dry = 0, unc = 0, anom = 0, sumM = 0;
    let d1 = 0, n1 = 0, d2 = 0, n2 = 0;
    let latest: Reading | undefined;
    for (const r of rs) {
      if (r.cls === "dry") dry++;
      if (r.cls === "uncertain") unc++;
      if (r.anomaly) anom++;
      sumM += r.moistureScore;
      if (r.ts < mid) { n1++; if (r.cls === "dry") d1++; } else { n2++; if (r.cls === "dry") d2++; }
      if (!latest || r.ts > latest.ts) latest = r;
    }
    const dryFraction = n ? dry / n : 0;
    const uncertainFraction = n ? unc / n : 0;
    const meanMoisture = n ? sumM / n : 0;
    const anomalyShare = n ? anom / n : 0;
    const trendDelta = n1 && n2 ? d2 / n2 - d1 / n1 : 0;
    const esi = n ? esiOf(meanMoisture, dryFraction, uncertainFraction, w) : 0;

    let status: Status = "green";
    if (n >= t.minReadings) {
      if (anomalyShare >= t.anomalyRed) status = "red";
      else if (dryFraction < t.blueDryMax) status = "blue";
      else if (anomalyShare >= t.anomalyAmber || esi >= t.pickupEsiMin || trendDelta <= -t.declineDelta) status = "amber";
    }
    const { rec, reasons } = recommend(status, { dryFraction, esi, anomalyShare, trendDelta }, t);
    return {
      area, count: n, dryFraction, uncertainFraction, meanMoisture, esi, anomalyShare, trendDelta,
      status, reasons, recommendation: rec, latest, rankAll: 0,
    };
  });

  [...out].sort((a, b) => b.esi - a.esi).forEach((m, i) => (m.rankAll = i + 1));
  return out;
}

const PRIORITY = { red: 0, amber: 1, blue: 2, green: 3 } as const;

export function buildQueue(metrics: AreaMetrics[]): QueueItem[] {
  return metrics
    .filter((m) => m.status !== "green")
    .sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || b.esi - a.esi)
    .map((m) => ({
      key: `${m.area.id}:${m.recommendation.type}`,
      areaId: m.area.id,
      priority: m.status === "red" ? "High" : m.status === "amber" ? "Moderate" : "Low",
      recommendation: m.recommendation,
      status: m.status,
    }));
}

export interface TrendPoint { label: string; moisture: number | null; dry: number | null; n: number }

export function buildTrend(readings: Reading[], areaIds: Set<string>, start: number, end: number, hourly: boolean): TrendPoint[] {
  const step = hourly ? 3600_000 : 86400_000;
  const buckets = Math.max(1, Math.ceil((end - start) / step));
  const sums = Array.from({ length: buckets }, () => ({ m: 0, d: 0, n: 0 }));
  for (const r of readings) {
    if (r.ts < start || r.ts > end || !areaIds.has(r.areaId)) continue;
    const i = Math.min(buckets - 1, Math.floor((r.ts - start) / step));
    const b = sums[i];
    b.m += r.moistureScore; b.n++; if (r.cls === "dry") b.d++;
  }
  return sums.map((b, i) => {
    const t = new Date(start + i * step);
    const label = hourly
      ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : t.toLocaleDateString([], { day: "numeric", month: "short" });
    return { label, n: b.n, moisture: b.n ? +(b.m / b.n).toFixed(3) : null, dry: b.n ? +(b.d / b.n).toFixed(3) : null };
  });
}
