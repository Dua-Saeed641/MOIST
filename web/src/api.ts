import { useCallback, useEffect, useRef, useState } from "react";

export const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8787";

export type WasteClass = "dry" | "wet" | "uncertain";
export type Status = "pickup" | "ok" | "watch" | "wet" | "inspect" | "idle";
export type Range = "24h" | "7d" | "30d";

export interface Reading {
  id: string;
  ts: number;
  device_id: string;
  area_id: string;
  area_name?: string;
  moisture_raw: number;
  moisture_score: number;
  moisture_slope?: number;
  class: WasteClass;
  certainty: number;
  anomaly: boolean;
  anomaly_reason?: string;
  air_temp_c?: number;
  air_rh_pct?: number;
  gas_raw?: number;
  distance_cm?: number;
}

export interface Stats {
  count: number;
  dry: number;
  wet: number;
  uncertain: number;
  dryShare: number;
  meanMoisture: number;
  esi: number;
  anomalies: number;
  anomalyShare: number;
  trend: number;
  status: Status;
}

export interface Area {
  id: string;
  name: string;
  ward: string;
  kind: string;
  lat: number;
  lon: number;
  stats: Stats;
  recommendation: { type: Status; title: string; detail: string };
  rank?: number;
}

export interface Kpis {
  checks: number;
  dryShare: number;
  wetShare: number;
  meanMoisture: number;
  esi: number;
  anomalies: number;
  gloves: number;
  areas: number;
}

export interface Point {
  t: number;
  count: number;
  dry: number;
  wet: number;
  dryShare: number | null;
  meanMoisture: number | null;
}

export interface Brief {
  text: string;
  source: "openrouter" | "bedrock" | "rules";
  model?: string;
  generated: number;
}

export interface Overview {
  range: Range;
  kpis: Kpis;
  previous: Kpis;
  areas: Area[];
  trend: Point[];
  brief: Brief | null;
}

export interface Device {
  id: string;
  last_seen: number;
  area_id: string;
  today: number;
}

export interface Live {
  now: number;
  readings: Reading[];
  devices: Device[];
  today: Kpis;
}

export interface AreaDetail extends Area {
  trend: Point[];
  recent: Reading[];
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}

/** GET `path` now and every `ms` (0 = once). Keeps the last good data while a refresh fails. */
export function usePoll<T>(path: string | null, ms = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    try {
      const d = await api<T>(path);
      if (n === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    load();
    if (!ms) return;
    const id = setInterval(() => { if (!document.hidden) load(); }, ms);
    return () => clearInterval(id);
  }, [load, ms]);
  return { data, error, reload: load };
}

/** Real-time stream: polls /live with ?since= so only new checks come back. */
export function useLive(ms = 2000) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [meta, setMeta] = useState<Omit<Live, "readings"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const since = useRef(0);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const d = await api<Live>(`/live?since=${since.current}`);
        if (!alive) return;
        if (d.readings.length) {
          since.current = Math.max(since.current, d.readings[0].ts);
          setReadings((old) => [...d.readings, ...old].slice(0, 120));
        }
        setMeta({ now: d.now, devices: d.devices, today: d.today });
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    tick();
    const id = setInterval(tick, ms);
    return () => { alive = false; clearInterval(id); };
  }, [ms]);
  return { readings, meta, error };
}

// ---------- formatting ----------
export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const num = (x: number) => x.toLocaleString("en-IN");

export function ago(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** Save rows as a CSV file (client side; nothing is uploaded). */
export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const isSim = (deviceId: string) => deviceId.startsWith("sim-");

export const STATUS: Record<Status, { label: string; tone: string }> = {
  pickup: { label: "Ready for pickup", tone: "good" },
  ok: { label: "Normal", tone: "calm" },
  watch: { label: "Watch", tone: "warn" },
  wet: { label: "Wet-dominant", tone: "wet" },
  inspect: { label: "Inspect", tone: "bad" },
  idle: { label: "Not rated", tone: "mute" },
};
