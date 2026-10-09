import { classify } from "../lib/metrics";
import type { Area, Reading } from "../types";
import type { DataSource } from "./source";

interface Profile extends Area {
  dry: number; // baseline share of dry items
  slope: number; // change in dry share per day (+ improving, - declining)
  anomaly: number; // share of anomalous readings
}

// Illustrative areas around Delhi. Figures are simulated, not real readings.
const PROFILES: Profile[] = [
  { id: "rohini-7", name: "Rohini Sector 7", ward: "Rohini", lat: 28.7041, lon: 77.1125, dry: 0.74, slope: 0.002, anomaly: 0.01 },
  { id: "rohini-16", name: "Rohini Sector 16", ward: "Rohini", lat: 28.7283, lon: 77.1158, dry: 0.58, slope: -0.006, anomaly: 0.02 },
  { id: "pitampura", name: "Pitampura", ward: "Keshav Puram", lat: 28.6992, lon: 77.1318, dry: 0.66, slope: 0.001, anomaly: 0.015 },
  { id: "shalimar-bagh", name: "Shalimar Bagh", ward: "Shalimar Bagh", lat: 28.7166, lon: 77.1632, dry: 0.78, slope: 0.003, anomaly: 0.01 },
  { id: "jahangirpuri", name: "Jahangirpuri", ward: "Jahangir Puri", lat: 28.7254, lon: 77.1714, dry: 0.22, slope: 0.001, anomaly: 0.03 },
  { id: "model-town", name: "Model Town", ward: "Model Town", lat: 28.7157, lon: 77.1934, dry: 0.7, slope: 0.001, anomaly: 0.012 },
  { id: "burari", name: "Burari", ward: "Burari", lat: 28.7523, lon: 77.2, dry: 0.35, slope: -0.008, anomaly: 0.05 },
  { id: "narela", name: "Narela", ward: "Narela", lat: 28.8527, lon: 77.0929, dry: 0.26, slope: 0.002, anomaly: 0.04 },
  { id: "bawana", name: "Bawana", ward: "Bawana", lat: 28.7984, lon: 77.0374, dry: 0.5, slope: 0.0, anomaly: 0.11 },
  { id: "ashok-vihar", name: "Ashok Vihar", ward: "Ashok Vihar", lat: 28.6951, lon: 77.1805, dry: 0.62, slope: -0.002, anomaly: 0.02 },
  { id: "mukherjee-nagar", name: "Mukherjee Nagar", ward: "Civil Lines", lat: 28.7114, lon: 77.2118, dry: 0.45, slope: -0.009, anomaly: 0.035 },
  { id: "civil-lines", name: "Civil Lines", ward: "Civil Lines", lat: 28.6811, lon: 77.2227, dry: 0.69, slope: 0.001, anomaly: 0.01 },
  { id: "karol-bagh", name: "Karol Bagh", ward: "Karol Bagh", lat: 28.6514, lon: 77.1907, dry: 0.28, slope: 0.0, anomaly: 0.06 },
  { id: "connaught-place", name: "Connaught Place", ward: "New Delhi", lat: 28.6315, lon: 77.2167, dry: 0.81, slope: 0.002, anomaly: 0.008 },
  { id: "rajouri-garden", name: "Rajouri Garden", ward: "Rajouri Garden", lat: 28.6492, lon: 77.1217, dry: 0.64, slope: 0.0, anomaly: 0.015 },
  { id: "janakpuri", name: "Janakpuri", ward: "Janakpuri", lat: 28.6219, lon: 77.0878, dry: 0.55, slope: -0.003, anomaly: 0.02 },
  { id: "dwarka-10", name: "Dwarka Sector 10", ward: "Dwarka", lat: 28.5823, lon: 77.0498, dry: 0.72, slope: 0.002, anomaly: 0.01 },
  { id: "najafgarh", name: "Najafgarh", ward: "Najafgarh", lat: 28.609, lon: 76.9855, dry: 0.24, slope: -0.003, anomaly: 0.045 },
  { id: "vasant-kunj", name: "Vasant Kunj", ward: "Vasant Kunj", lat: 28.5199, lon: 77.1588, dry: 0.76, slope: 0.001, anomaly: 0.01 },
  { id: "saket", name: "Saket", ward: "Saket", lat: 28.5245, lon: 77.2066, dry: 0.6, slope: 0.001, anomaly: 0.02 },
  { id: "lajpat-nagar", name: "Lajpat Nagar", ward: "Lajpat Nagar", lat: 28.5677, lon: 77.2433, dry: 0.4, slope: 0.003, anomaly: 0.025 },
  { id: "okhla", name: "Okhla Phase 1", ward: "Okhla", lat: 28.5355, lon: 77.2707, dry: 0.68, slope: 0.0, anomaly: 0.09 },
  { id: "mayur-vihar", name: "Mayur Vihar", ward: "Mayur Vihar", lat: 28.6073, lon: 77.2955, dry: 0.52, slope: -0.004, anomaly: 0.02 },
  { id: "shahdara", name: "Shahdara", ward: "Shahdara", lat: 28.6731, lon: 77.2891, dry: 0.31, slope: 0.001, anomaly: 0.03 },
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const DAY = 86400_000;

function makeReading(p: Profile, ts: number, daysAgo: number, rand: () => number, id: string): Reading {
  const dryShare = clamp01(p.dry - p.slope * daysAgo);
  const anomaly = rand() < p.anomaly;
  let m: number;
  if (anomaly) m = clamp01(0.88 + gauss(rand) * 0.06);
  else if (rand() < 0.08) m = clamp01(0.5 + gauss(rand) * 0.06);
  else if (rand() < dryShare) m = clamp01(0.2 + gauss(rand) * 0.09);
  else m = clamp01(0.78 + gauss(rand) * 0.1);
  const temp = 24 + rand() * 10;
  return {
    id,
    areaId: p.id,
    deviceId: `glove-0${1 + Math.floor(rand() * 3)}`,
    ts,
    moistureRaw: Math.round(1023 * (1 - m) + gauss(rand) * 12),
    moistureScore: +m.toFixed(3),
    cls: classify(m),
    anomaly,
    airTempC: +temp.toFixed(1),
    airRhPct: +(45 + rand() * 35).toFixed(0),
  };
}

export class SampleDataSource implements DataSource {
  readonly label = "Simulated feed";
  readonly isSimulated = true;
  async loadAreas(): Promise<Area[]> {
    return PROFILES.map(({ id, name, ward, lat, lon }) => ({ id, name, ward, kind: "collection_point" as const, lat, lon }));
  }
  private counter = 0;
  private liveRand = mulberry32(Date.now() % 100000);

  async loadReadings(): Promise<Reading[]> {
    const now = Date.now();
    const rand = mulberry32(2026);
    const out: Reading[] = [];
    for (const p of PROFILES) {
      for (let d = 29; d >= 0; d--) {
        const n = 9 + Math.floor(rand() * 10);
        for (let i = 0; i < n; i++) {
          const ts = now - d * DAY - rand() * DAY;
          if (ts > now) continue;
          out.push(makeReading(p, ts, d, rand, `s-${this.counter++}`));
        }
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  subscribe(onReading: (r: Reading) => void): () => void {
    const timer = setInterval(() => {
      const p = PROFILES[Math.floor(this.liveRand() * PROFILES.length)];
      onReading(makeReading(p, Date.now(), 0, this.liveRand, `live-${this.counter++}`));
    }, 2500);
    return () => clearInterval(timer);
  }
}
