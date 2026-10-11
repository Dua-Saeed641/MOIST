import type { ActionState, Area, Reading } from "../types";
import type { DataSource } from "./source";

const DAY = 86400_000;
const POLL_MS = 3000;

interface ApiReading {
  id: string;
  area_id: string;
  device_id: string;
  ts: number;
  moisture_raw: number;
  moisture_score: number;
  class: Reading["cls"];
  anomaly: boolean;
  air_temp_c?: number;
  air_rh_pct?: number;
  distance_cm?: number | null;
  gas_raw?: number | null;
}

const toReading = (r: ApiReading): Reading => ({
  id: r.id,
  areaId: r.area_id,
  deviceId: r.device_id,
  ts: r.ts,
  moistureRaw: r.moisture_raw,
  moistureScore: r.moisture_score,
  cls: r.class,
  anomaly: r.anomaly,
  airTempC: r.air_temp_c ?? 0,
  airRhPct: r.air_rh_pct ?? 0,
  distanceCm: r.distance_cm ?? null,
  gasRaw: r.gas_raw ?? null,
});

export class HttpDataSource implements DataSource {
  readonly label = "Live";
  readonly isSimulated = false;
  private lastTs = 0;
  private seen = new Set<string>();

  constructor(private base: string, private apiKey?: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.base + path, {
      ...init,
      headers: { "content-type": "application/json", ...(this.apiKey ? { "x-api-key": this.apiKey } : {}) },
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }

  async loadAreas(): Promise<Area[]> {
    const { areas } = await this.req<{ areas: { id: string; name: string; ward?: string; kind?: Area["kind"]; lat: number; lon: number }[] }>("/areas");
    return areas.map((a) => ({ id: a.id, name: a.name, ward: a.ward ?? "", kind: a.kind, lat: a.lat, lon: a.lon }));
  }

  async loadReadings(): Promise<Reading[]> {
    const { readings } = await this.req<{ readings: ApiReading[] }>(`/readings?from=${Date.now() - 30 * DAY}&limit=20000`);
    const out = readings.map(toReading);
    out.forEach((r) => this.seen.add(r.id));
    this.lastTs = out.length ? out[out.length - 1].ts : Date.now();
    return out;
  }

  subscribe(onReading: (r: Reading) => void): () => void {
    let stopped = false;
    const tick = async () => {
      try {
        const { readings } = await this.req<{ readings: ApiReading[] }>(`/readings?from=${this.lastTs}&limit=500`);
        for (const r of readings.map(toReading)) {
          if (this.seen.has(r.id)) continue;
          this.seen.add(r.id);
          this.lastTs = Math.max(this.lastTs, r.ts);
          onReading(r);
        }
      } catch {
        /* transient network error: try again on the next poll */
      }
    };
    const timer = setInterval(() => !stopped && tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async loadActions(): Promise<Record<string, ActionState>> {
    return (await this.req<{ actions: Record<string, ActionState> }>("/actions")).actions;
  }

  async saveAction(key: string, state: ActionState): Promise<void> {
    await this.req(`/actions/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ state }) });
  }
}
