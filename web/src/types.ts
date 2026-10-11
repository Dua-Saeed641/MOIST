export type WasteClass = "wet" | "dry" | "uncertain";
export type Status = "red" | "amber" | "green" | "blue";
export type ActionType = "inspection" | "pickup" | "campaign" | "monitor" | "none";
export type ActionState = "open" | "scheduled" | "done";

export type AreaKind = "collection_point" | "transfer_station" | "colony";

export interface Area {
  id: string;
  name: string;
  ward: string;
  /** What the pin is: where the glove is actually used. Default: collection_point. */
  kind?: AreaKind;
  lat: number;
  lon: number;
}

/** Mirrors the POST /readings payload + the fields the ingest Lambda adds (class, moisture_score). */
export interface Reading {
  id: string;
  areaId: string;
  deviceId: string;
  ts: number; // epoch ms (UTC)
  moistureRaw: number;
  moistureScore: number; // 0 dry .. 1 wet
  cls: WasteClass;
  anomaly: boolean;
  airTempC: number;
  airRhPct: number;
  distanceCm: number | null; // sonar distance at measurement (glove); null if unknown
  gasRaw: number | null; // gas sensor, if fitted
}

export interface Recommendation {
  type: ActionType;
  title: string;
  detail: string;
}

export interface AreaMetrics {
  area: Area;
  count: number;
  dryFraction: number;
  uncertainFraction: number;
  meanMoisture: number;
  esi: number;
  anomalyShare: number;
  trendDelta: number; // dry fraction: second half minus first half of range
  status: Status;
  reasons: string[];
  recommendation: Recommendation;
  latest?: Reading;
  rankAll: number; // 1 = best ESI among all monitored areas
}

export interface QueueItem {
  key: string;
  areaId: string;
  priority: "High" | "Moderate" | "Low";
  recommendation: Recommendation;
  status: Status;
}
