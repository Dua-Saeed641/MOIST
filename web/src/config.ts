export const PROJECT_NAME = "MØIST";
export const BUILT_BY = "Built by Lovekesh and Dua";

export interface Thresholds {
  /** Dry fraction below this => wet-dominant (blue). */
  blueDryMax: number;
  /** ESI at or above this => schedule dry-waste pickup (amber). */
  pickupEsiMin: number;
  /** Share of anomalous readings => amber / red. */
  anomalyAmber: number;
  anomalyRed: number;
  /** Drop in dry fraction (second half vs first half of range) flagged as declining. */
  declineDelta: number;
  /** Minimum readings in range before an area is considered for alerts. */
  minReadings: number;
}

/** ESI weights from the report (section 9.5): w1 (1-M), w2 f_dry, w3 (1-f_unc). Must sum to 1. */
export interface EsiWeights {
  w1: number;
  w2: number;
  w3: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  blueDryMax: 0.3,
  pickupEsiMin: 70,
  anomalyAmber: 0.04,
  anomalyRed: 0.08,
  declineDelta: 0.08,
  minReadings: 5,
};

export const DEFAULT_WEIGHTS: EsiWeights = { w1: 0.5, w2: 0.3, w3: 0.2 };

/** Class cut-offs on the moisture score M (0 dry .. 1 wet). Mirrors the model's confidence band. */
export const CLASS_CUTOFFS = { dryMax: 0.38, wetMin: 0.62 };

export function validateConfig(t: Thresholds, w: EsiWeights): string[] {
  const errs: string[] = [];
  if (!(t.blueDryMax > 0 && t.blueDryMax < 1)) errs.push("Wet-dominant cut-off must be between 0 and 1.");
  if (!(t.pickupEsiMin > 0 && t.pickupEsiMin <= 100)) errs.push("Pickup ESI must be between 0 and 100.");
  if (!(t.anomalyAmber >= 0 && t.anomalyRed <= 1)) errs.push("Anomaly shares must be within 0 and 1.");
  if (!(t.anomalyAmber < t.anomalyRed)) errs.push("Amber anomaly share must be lower than red.");
  if (!(t.declineDelta > 0 && t.declineDelta < 1)) errs.push("Decline delta must be between 0 and 1.");
  if (!(t.minReadings >= 1)) errs.push("Minimum readings must be at least 1.");
  if ([w.w1, w.w2, w.w3].some((x) => x < 0 || x > 1)) errs.push("ESI weights must each be between 0 and 1.");
  if (Math.abs(w.w1 + w.w2 + w.w3 - 1) > 0.001) errs.push("ESI weights must sum to 1.");
  return errs;
}

export const RANGES = [
  { key: "24h", label: "24 hours", ms: 24 * 3600 * 1000 },
  { key: "7d", label: "7 days", ms: 7 * 24 * 3600 * 1000 },
  { key: "30d", label: "30 days", ms: 30 * 24 * 3600 * 1000 },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];
