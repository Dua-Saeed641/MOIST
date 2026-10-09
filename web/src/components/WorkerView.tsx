import { useMemo, useState } from "react";
import type { ActionState, ActionType, AreaMetrics } from "../types";
import { TASK_ORDER, TASKS, UI, reasonFor, speak } from "../lib/tasks";
import { Icon } from "./Icon";
import { Shape, STATUS_META } from "./Status";

interface Props {
  metrics: AreaMetrics[];
  states: Record<string, ActionState>;
  onState: (key: string, s: ActionState) => void;
  onShowOnMap: (areaId: string) => void;
}

const keyOf = (m: AreaMetrics) => `${m.area.id}:${m.recommendation.type}`;

export function WorkerView({ metrics, states, onState, onShowOnMap }: Props) {
  const [picked, setPicked] = useState<ActionType | null>(null);

  const groups = useMemo(() => {
    const g: Record<ActionType, AreaMetrics[]> = { inspection: [], pickup: [], campaign: [], monitor: [], none: [] };
    metrics.forEach((m) => g[m.recommendation.type].push(m));
    (Object.keys(g) as ActionType[]).forEach((k) => g[k].sort((a, b) => a.area.name.localeCompare(b.area.name)));
    return g;
  }, [metrics]);

  const pending = (t: ActionType) => (t === "none" ? groups.none.length : groups[t].filter((m) => (states[keyOf(m)] ?? "open") !== "done").length);
  const active: ActionType = picked ?? TASK_ORDER.find((t) => t !== "none" && pending(t) > 0) ?? "none";
  const list = groups[active];
  const info = TASKS[active];

  return (
    <section className="worker">
      <div className="worker-head">
        <h2>
          {UI.heading.en} <span className="hi">· {UI.heading.hi}</span>
        </h2>
        <p>
          {UI.sub.en} <span className="hi">{UI.sub.hi}</span>
        </p>
      </div>

      <div className="tiles">
        {TASK_ORDER.map((t) => {
          const ti = TASKS[t];
          const color = STATUS_META[ti.status].color;
          return (
            <button key={t} className={`tile ${t === active ? "on" : ""}`} style={{ ["--c" as string]: color }} onClick={() => setPicked(t)} aria-pressed={t === active}>
              <span className="tile-icon">
                <Icon name={ti.icon} size={38} />
              </span>
              <span className="tile-count">{pending(t)}</span>
              <span className="tile-label">{ti.en.title}</span>
              <span className="tile-label hi">{ti.hi.title}</span>
              <span className="tile-shape">
                <Shape status={ti.status} size={18} />
              </span>
            </button>
          );
        })}
      </div>

      <ul className="cards">
        {list.length === 0 && (
          <li className="empty-card">
            {UI.nothing.en} <span className="hi">{UI.nothing.hi}</span>
          </li>
        )}
        {list.map((m) => {
          const k = keyOf(m);
          const done = active !== "none" && (states[k] ?? "open") === "done";
          const why = reasonFor(m);
          const spoken = `${m.area.name}. ${info.hi.title}. ${why.hi}`;
          return (
            <li key={k} className={`card ${done ? "done" : ""}`} style={{ ["--c" as string]: STATUS_META[info.status].color }}>
              <span className="card-icon">
                <Icon name={info.icon} size={34} />
              </span>
              <div className="card-main">
                <h3>{m.area.name}</h3>
                <p className="t-en">{info.en.title}</p>
                <p className="t-hi">{info.hi.title}</p>
                <p className="why">
                  <b>{UI.why.en} · {UI.why.hi}:</b> {why.en}
                  <span className="hi"> {why.hi}</span>
                </p>
              </div>
              <div className="card-actions">
                <button className="big ghostbtn" onClick={() => speak(spoken)} aria-label={`${UI.listen.en} - ${m.area.name}`}>
                  <Icon name="speaker" size={22} />
                  <span>
                    {UI.listen.en}
                    <small>{UI.listen.hi}</small>
                  </span>
                </button>
                <button className="big ghostbtn" onClick={() => onShowOnMap(m.area.id)}>
                  <Icon name="map" size={22} />
                  <span>
                    {UI.onMap.en}
                    <small>{UI.onMap.hi}</small>
                  </span>
                </button>
                {active !== "none" && (
                  <button className={`big donebtn ${done ? "is-done" : ""}`} onClick={() => onState(k, done ? "open" : "done")}>
                    <Icon name="check" size={24} />
                    <span>
                      {done ? UI.undo.en : UI.done.en}
                      <small>{done ? UI.undo.hi : UI.done.hi}</small>
                    </span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
