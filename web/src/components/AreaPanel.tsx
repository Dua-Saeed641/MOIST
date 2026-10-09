import type { ActionState, AreaMetrics } from "../types";
import { KIND_LABEL } from "../lib/tasks";
import { StatusBadge, STATUS_META } from "./Status";

interface Props {
  metric: AreaMetrics | null;
  total: number;
  inView: number;
  rankInView: number | null;
  actionState: ActionState;
  onActionState: (s: ActionState) => void;
  onClose: () => void;
}

export function AreaPanel({ metric, total, inView, rankInView, actionState, onActionState, onClose }: Props) {
  if (!metric) {
    return (
      <aside className="panel empty">
        <h3>Area details</h3>
        <p>Click a marker on the map to see how that area is doing and what to do next.</p>
      </aside>
    );
  }
  const { area, recommendation: rec } = metric;
  const l = metric.latest;
  return (
    <aside className="panel">
      <div className="panel-head">
        <div>
          <h3>{area.name}</h3>
          <span className="muted">{KIND_LABEL[area.kind ?? "collection_point"]} · {area.ward} ward</span>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>
      <StatusBadge status={metric.status} />

      <div className="stats">
        <Stat label="Dry waste" value={`${Math.round(metric.dryFraction * 100)}%`} sub="of everything checked" />
        <Stat
          label="Energy score"
          value={metric.esi.toFixed(0)}
          sub={`#${metric.rankAll} of ${total}${rankInView && inView < total ? ` · #${rankInView} in view` : ""}`}
        />
        <Stat label="Wetness" value={metric.meanMoisture.toFixed(2)} sub="0 = dry, 1 = wet" />
        <Stat label="Unusual loads" value={`${(metric.anomalyShare * 100).toFixed(0)}%`} sub={`${metric.count} checks`} />
      </div>

      <p className="latest">
        {l ? (
          <>
            Last check: <b>{l.cls}</b> at {new Date(l.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {l.anomaly && <span className="flag"> · unusual</span>}
          </>
        ) : (
          <span className="muted">No checks in this period.</span>
        )}
      </p>

      <div className="rec" style={{ borderLeftColor: STATUS_META[metric.status].color }}>
        <h4>What to do</h4>
        <b>{rec.title}</b>
        <p>{rec.detail}</p>
        {rec.type !== "none" && (
          <div className="seg small" role="group" aria-label="Action status">
            {(["open", "scheduled", "done"] as ActionState[]).map((s) => (
              <button key={s} className={s === actionState ? "on" : ""} onClick={() => onActionState(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="kpi-l">{label}</span>
      <span className="stat-v">{value}</span>
      {sub && <span className="muted tiny">{sub}</span>}
    </div>
  );
}
