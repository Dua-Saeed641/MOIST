import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AreaMetrics, Reading, Status } from "../types";
import { buildTrend } from "../lib/metrics";
import { Shape, STATUS_META, STATUS_ORDER } from "./Status";

interface Props {
  metrics: AreaMetrics[]; // all areas
  visible: AreaMetrics[]; // areas in the current viewport
  isFiltered: boolean;
  readings: Reading[];
  start: number;
  end: number;
  hourly: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReset: () => void;
}

const AXIS = { fontSize: 12, fill: "#6b7280", fontFamily: "var(--mono)" };
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tip">
      <div className="tip-h">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="tip-r">
          <i style={{ background: p.color }} />
          {p.name}
          <b>{p.value?.toFixed(2)}</b>
        </div>
      ))}
    </div>
  );
}

export function Analytics({ metrics, visible, isFiltered, readings, start, end, hourly, selectedId, onSelect, onReset }: Props) {
  const ids = useMemo(() => new Set(visible.map((v) => v.area.id)), [visible]);
  const trend = useMemo(() => buildTrend(readings, ids, start, end, hourly), [readings, ids, start, end, hourly]);
  const ranked = useMemo(() => [...visible].filter((m) => m.count > 0).sort((a, b) => b.esi - a.esi), [visible]);
  const counts = useMemo(() => {
    const c: Record<Status, number> = { red: 0, amber: 0, green: 0, blue: 0 };
    visible.forEach((v) => c[v.status]++);
    return c;
  }, [visible]);
  const scope = isFiltered ? `${visible.length} of ${metrics.length} areas in map view` : `All ${metrics.length} areas`;

  return (
    <section className="analytics">
      <div className="section-head">
        <div>
          <h2>Analytics</h2>
          <p className="sub">Move or zoom the map and these charts follow it.</p>
        </div>
        <span className={`chip ${isFiltered ? "warn" : ""}`}>{scope}</span>
        {isFiltered && (
          <button className="outline" onClick={onReset}>
            Reset to all areas
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="muted pad">No monitored areas in the current map view. Zoom out or reset to all areas.</p>
      ) : (
        <>
          <article className="panelcard">
            <header className="pc-head">
              <h3>Wetness over time</h3>
              <span className="chip ok">{hourly ? "Hourly" : "Daily"}</span>
              <span className="chip right">
                <i className="sw" style={{ background: "#0f172a" }} /> Wetness
                <i className="sw dashed" style={{ borderColor: "#7c3aed" }} /> Dry share
              </span>
            </header>
            <div className="pc-body">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 14, right: 20, bottom: 18, left: 8 }}>
                  <CartesianGrid stroke="#eef0f2" strokeDasharray="0" />
                  <XAxis
                    dataKey="label"
                    tick={AXIS}
                    tickLine={false}
                    axisLine={{ stroke: "#d1d5db" }}
                    interval="preserveStartEnd"
                    minTickGap={40}
                    label={{ value: hourly ? "TIME" : "DATE", position: "insideBottomRight", offset: -4, style: { ...AXIS, letterSpacing: 1.2 } }}
                  />
                  <YAxis
                    domain={[0, 1]}
                    ticks={[0, 0.25, 0.5, 0.75, 1]}
                    tick={AXIS}
                    tickLine={false}
                    axisLine={{ stroke: "#d1d5db" }}
                    width={44}
                    label={{ value: "0 = DRY · 1 = WET", angle: -90, position: "insideLeft", offset: 6, style: { ...AXIS, letterSpacing: 1.2, textAnchor: "middle" } }}
                  />
                  <Tooltip content={<ChartTip />} cursor={{ stroke: "#9ca3af", strokeDasharray: "3 3" }} />
                  <Legend wrapperStyle={{ display: "none" }} />
                  <Line type="monotone" dataKey="moisture" name="Wetness" stroke="#0f172a" strokeWidth={1.6} dot={false} activeDot={{ r: 3.5 }} connectNulls />
                  <Line type="monotone" dataKey="dry" name="Dry share" stroke="#7c3aed" strokeWidth={1.6} strokeDasharray="5 3" dot={false} activeDot={{ r: 3.5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <footer className="pc-foot">
              <span>
                Range: <b>{fmtDate(start)} – {fmtDate(end)}</b>
              </span>
              <span className="hint">Hover over the lines for values</span>
            </footer>
          </article>

          <div className="row2">
            <article className="panelcard">
              <header className="pc-head">
                <h3>Best areas for energy plants</h3>
                <span className="chip ok">Top {Math.min(8, ranked.length)}</span>
                <span className="chip right">Higher score = drier, cleaner waste</span>
              </header>
              <ol className="rank">
                {ranked.slice(0, 8).map((m, i) => (
                  <li key={m.area.id} className={m.area.id === selectedId ? "sel" : ""}>
                    <button onClick={() => onSelect(m.area.id)}>
                      <span className="rk">{String(i + 1).padStart(2, "0")}</span>
                      <Shape status={m.status} />
                      <span className="nm">{m.area.name}</span>
                      <span className="bar">
                        <i style={{ width: `${Math.min(100, m.esi)}%`, background: STATUS_META[m.status].color }} />
                      </span>
                      <span className="val">{m.esi.toFixed(0)}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <footer className="pc-foot">
                <span>
                  Ranked within: <b>{isFiltered ? "map view" : "all areas"}</b>
                </span>
                <span className="hint">Click a row to open the area</span>
              </footer>
            </article>

            <article className="panelcard">
              <header className="pc-head">
                <h3>Area status</h3>
                <span className="chip ok">{visible.length} areas</span>
              </header>
              <div className="dist-body">
                <div className="stack" role="img" aria-label="Areas by status">
                  {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
                    <i key={s} style={{ flex: counts[s], background: STATUS_META[s].color }} />
                  ))}
                </div>
                <ul className="dist">
                  {STATUS_ORDER.map((s) => (
                    <li key={s}>
                      <Shape status={s} />
                      <span>{STATUS_META[s].label}</span>
                      <b>{counts[s]}</b>
                      <span className="muted">{visible.length ? Math.round((counts[s] / visible.length) * 100) : 0}%</span>
                    </li>
                  ))}
                </ul>
              </div>
              <footer className="pc-foot">
                <span>
                  Scope: <b>{isFiltered ? "map view" : "all areas"}</b>
                </span>
              </footer>
            </article>
          </div>
        </>
      )}
    </section>
  );
}
