import { useState } from "react";
import { api, pct, usePoll, type Overview, type Range } from "../api";
import AreaMap, { esiColor } from "../components/AreaMap";
import { Card, Empty, ErrorNote, Icon, StatusBadge } from "../components/ui";
import BriefCard from "./BriefCard";

type ActionState = "open" | "scheduled" | "done";
const NEXT: Record<ActionState, ActionState> = { open: "scheduled", scheduled: "done", done: "open" };
const STATE_LABEL: Record<ActionState, string> = { open: "Open", scheduled: "Scheduled", done: "Done" };

export default function Energy({ range }: { range: Range }) {
  const { data, error } = usePoll<Overview>(`/overview?range=${range}`, 15000);
  const actions = usePoll<{ actions: Record<string, ActionState> }>("/actions");
  const [local, setLocal] = useState<Record<string, ActionState>>({});
  if (!data) return <><ErrorNote error={error} />{!error && <div className="skeleton" />}</>;

  const states = { ...actions.data?.actions, ...local };
  const rated = data.areas.filter((a) => a.stats.count).sort((a, b) => b.stats.esi - a.stats.esi);
  const queue = rated.filter((a) => !["ok", "idle"].includes(a.stats.status));
  const pickup = rated.filter((a) => a.stats.status === "pickup");
  const dryItems = pickup.reduce((s, a) => s + a.stats.dry, 0);

  const cycle = async (key: string) => {
    const next = NEXT[states[key] ?? "open"];
    setLocal((s) => ({ ...s, [key]: next }));
    try { await api(`/actions/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ state: next }) }); }
    catch { setLocal((s) => ({ ...s, [key]: states[key] ?? "open" })); }
  };

  return (
    <>
      <ErrorNote error={error} />
      <div className="esi-explain">
        <div>
          <span className="eyebrow">Energy Suitability Index</span>
          <p className="esi-formula">ESI = 100 × (0.5·(1 − moisture) + 0.3·dry share + 0.2·(1 − unsure share))</p>
          <p className="muted small">A high index means dry, low-moisture waste suitable for refuse-derived fuel. Collection points at 70 or above are recommended for direct transport to the energy plant.</p>
        </div>
        <div className="esi-stats">
          <div><strong>{pickup.length}</strong><span>ready for plant pickup</span></div>
          <div><strong>{dryItems.toLocaleString("en-IN")}</strong><span>dry items from those points</span></div>
          <div><strong>{rated.filter((a) => a.stats.status === "wet").length}</strong><span>need a segregation drive</span></div>
        </div>
      </div>

      <div className="grid-2-1">
        <Card title="Area ranking" pad={false}>
          {rated.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>Area</th><th>ESI</th><th>Dry share</th><th>Trend</th><th>Readings</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {rated.map((a) => (
                    <tr key={a.id}>
                      <td className="mono muted">{a.rank}</td>
                      <td><strong>{a.name}</strong><div className="muted small">{a.ward}</div></td>
                      <td>
                        <div className="esi-cell">
                          <div className="esi-track"><div style={{ width: `${a.stats.esi}%`, background: esiColor(a.stats.esi, a.stats.count) }} /></div>
                          <span className="mono">{a.stats.esi.toFixed(0)}</span>
                        </div>
                      </td>
                      <td className="mono">{pct(a.stats.dryShare)}</td>
                      <td className={`mono ${a.stats.trend > 0.02 ? "good" : a.stats.trend < -0.02 ? "bad" : "muted"}`}>
                        {a.stats.trend > 0 ? "+" : ""}{(a.stats.trend * 100).toFixed(0)} pts
                      </td>
                      <td className="mono">{a.stats.count}</td>
                      <td><StatusBadge status={a.stats.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No checks in this period.</Empty>}
        </Card>
        <BriefCard initial={data.brief} />
      </div>

      <div className="grid-2-1">
        <Card title="Action queue" action={<span className="muted small">Select a status to update it</span>}>
          {queue.length ? (
            <ul className="queue">
              {queue.map((a) => {
                const key = `${a.id}:${a.stats.status}`;
                const st = states[key] ?? "open";
                return (
                  <li key={key} className={st === "done" ? "done" : ""}>
                    <span className={`queue-icon tone-${a.stats.status}`}>
                      <Icon name={a.stats.status === "pickup" ? "zap" : a.stats.status === "inspect" ? "alert" : "drop"} size={16} />
                    </span>
                    <div className="queue-main">
                      <strong>{a.recommendation.title}</strong>
                      <span>{a.name} · {a.recommendation.detail}</span>
                    </div>
                    <button className={`state state-${st}`} onClick={() => cycle(key)}>{STATE_LABEL[st]}</button>
                  </li>
                );
              })}
            </ul>
          ) : <Empty>Nothing to act on. Every rated area is within normal range.</Empty>}
        </Card>
        <Card title="Feedstock map" pad={false}>
          <AreaMap areas={data.areas} height={360} />
        </Card>
      </div>
    </>
  );
}
