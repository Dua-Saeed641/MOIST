import { useState } from "react";
import type { AreaMetrics, Reading } from "../types";

interface Props {
  readings: Reading[]; // newest last
  metrics: AreaMetrics[];
  onSelect: (areaId: string) => void;
}

export function LiveFeed({ readings, metrics, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const names = new Map(metrics.map((m) => [m.area.id, m.area.name]));
  const rows = readings.slice(expanded ? -30 : -5).reverse();

  return (
    <section className="feed">
      <div className="section-head">
        <h2>Latest checks</h2>
        <span className="live-pill">
          <span className="dot" /> live
        </span>
        <button className="ghost" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Place</th>
            <th>Result</th>
            <th>Wetness</th>
            {expanded && (
              <>
                <th>Sensor</th>
                <th>Temp</th>
                <th>Humidity</th>
                <th>Distance</th>
                <th>Gas</th>
                <th>Device</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="newrow" onClick={() => onSelect(r.areaId)}>
              <td>{new Date(r.ts).toLocaleTimeString()}</td>
              <td>{names.get(r.areaId) ?? r.areaId}</td>
              <td>
                <span className={`cls ${r.cls}`}>{r.cls}</span>
                {r.anomaly && <span className="flag"> ⚠ unusual</span>}
              </td>
              <td>{r.moistureScore.toFixed(2)}</td>
              {expanded && (
                <>
                  <td>{r.moistureRaw}</td>
                  <td>{r.airTempC}°C</td>
                  <td>{r.airRhPct}%</td>
                  <td>{r.distanceCm != null ? `${r.distanceCm} cm` : "—"}</td>
                  <td>{r.gasRaw ?? "—"}</td>
                  <td>{r.deviceId}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
