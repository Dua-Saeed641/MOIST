import { useState } from "react";
import { EsiWeights, RANGES, RangeKey, Thresholds, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, validateConfig } from "../config";
import type { AreaMetrics } from "../types";

interface Props {
  range: RangeKey;
  onRange: (r: RangeKey) => void;
  metrics: AreaMetrics[];
  thresholds: Thresholds;
  weights: EsiWeights;
  onConfig: (t: Thresholds, w: EsiWeights) => void;
}

export function TopBar({ range, onRange, metrics, thresholds, weights, onConfig }: Props) {
  const [open, setOpen] = useState(false);
  const total = metrics.reduce((s, m) => s + m.count, 0);
  const dry = metrics.reduce((s, m) => s + m.dryFraction * m.count, 0);
  const moist = metrics.reduce((s, m) => s + m.meanMoisture * m.count, 0);
  const alerts = metrics.filter((m) => m.status === "red" || m.status === "amber").length;
  const high = metrics.filter((m) => m.status === "red").length;

  return (
    <div className="topbar">
      <div className="topbar-row">
        <div className="seg" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.key} className={r.key === range ? "on" : ""} onClick={() => onRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>

        <div className="kpis" aria-label="Headline metrics for all monitored areas">
          <span className="scope">All {metrics.length} areas</span>
          <Kpi label="Readings" value={total.toLocaleString()} />
          <Kpi label="Dry waste" value={total ? `${Math.round((dry / total) * 100)}%` : "-"} />
          <Kpi label="Wetness" value={total ? (moist / total).toFixed(2) : "-"} />
          <Kpi label="Need action" value={`${alerts}`} sub={high ? `${high} high` : undefined} />
        </div>

        <button className="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Alert settings
        </button>
      </div>

      {open && <ConfigPanel thresholds={thresholds} weights={weights} onApply={onConfig} />}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-v">{value}</span>
      <span className="kpi-l">
        {label}
        {sub ? ` · ${sub}` : ""}
      </span>
    </div>
  );
}

function ConfigPanel({ thresholds, weights, onApply }: { thresholds: Thresholds; weights: EsiWeights; onApply: (t: Thresholds, w: EsiWeights) => void }) {
  const [t, setT] = useState(thresholds);
  const [w, setW] = useState(weights);
  const errors = validateConfig(t, w);
  const tf = (k: keyof Thresholds, label: string, step: number) => (
    <label key={k}>
      {label}
      <input type="number" step={step} value={t[k]} onChange={(e) => setT({ ...t, [k]: Number(e.target.value) })} />
    </label>
  );
  const wf = (k: keyof EsiWeights, label: string) => (
    <label key={k}>
      {label}
      <input type="number" step={0.05} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="config">
      <div className="config-cols">
        <div>
          <h4 className="micro">1. Area status</h4>
          {tf("blueDryMax", "Wet-dominant if dry fraction below", 0.05)}
          {tf("pickupEsiMin", "Pickup if ESI at least", 1)}
          {tf("minReadings", "Min readings per area", 1)}
        </div>
        <div>
          <h4 className="micro">2. Anomalies and trend</h4>
          {tf("anomalyAmber", "Amber anomaly share", 0.01)}
          {tf("anomalyRed", "Red anomaly share", 0.01)}
          {tf("declineDelta", "Declining if dry fraction drops by", 0.01)}
        </div>
        <div>
          <h4 className="micro">3. ESI weights (sum to 1)</h4>
          {wf("w1", "Moisture")}
          {wf("w2", "Dry fraction")}
          {wf("w3", "Certainty")}
        </div>
      </div>
      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="config-actions">
        <button className="primary" disabled={errors.length > 0} onClick={() => onApply(t, w)}>
          Apply
        </button>
        <button
          className="ghost"
          onClick={() => {
            setT(DEFAULT_THRESHOLDS);
            setW(DEFAULT_WEIGHTS);
            onApply(DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS);
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
