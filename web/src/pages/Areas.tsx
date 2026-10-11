import { useEffect, useState } from "react";
import { isSim, pct, time, usePoll, type AreaDetail, type Overview, type Range } from "../api";
import AreaMap from "../components/AreaMap";
import { Card, ClassPill, Empty, ErrorNote, StatusBadge } from "../components/ui";
import { TrendChart } from "./Overview";

const KIND: Record<string, string> = { collection_point: "Collection point", transfer_station: "Transfer station", colony: "Colony" };

function Detail({ id, range }: { id: string; range: Range }) {
  const { data } = usePoll<AreaDetail>(`/areas/${encodeURIComponent(id)}?range=${range}`, 15000);
  if (!data) return <div className="skeleton" />;
  const s = data.stats;
  return (
    <Card title={<>{data.name} <span className="muted small">· {KIND[data.kind] ?? data.kind}, {data.ward}</span></>}
      action={<StatusBadge status={s.status} />}>
      <div className="mini-stats">
        <div><span>ESI</span><strong>{s.count ? s.esi.toFixed(0) : "—"}</strong></div>
        <div><span>Dry share</span><strong>{pct(s.dryShare)}</strong></div>
        <div><span>Mean moisture</span><strong>{s.meanMoisture.toFixed(2)}</strong></div>
        <div><span>Checks</span><strong>{s.count}</strong></div>
        <div><span>Untrusted</span><strong>{s.anomalies}</strong></div>
      </div>
      <p className="rec"><strong>{data.recommendation.title}.</strong> {data.recommendation.detail}</p>
      {s.count ? <TrendChart data={data.trend} range={range} height={200} /> : null}
      <h4 className="sub-h">Recent checks</h4>
      {data.recent.length ? (
        <ul className="recent">
          {data.recent.slice(0, 10).map((r) => (
            <li key={r.id}>
              <span className="mono muted">{time(r.ts)}</span>
              <ClassPill cls={r.class} />
              <span className="mono">{r.moisture_score.toFixed(2)}</span>
              <span className="muted">{r.device_id}{isSim(r.device_id) ? " (sim)" : ""}</span>
            </li>
          ))}
        </ul>
      ) : <Empty>No checks in this period.</Empty>}
    </Card>
  );
}

export default function Areas({ range }: { range: Range }) {
  const { data, error } = usePoll<Overview>(`/overview?range=${range}`, 15000);
  const [sel, setSel] = useState<string | null>(() => window.location.hash.split("?")[1] || null);
  useEffect(() => {
    if (!sel && data?.areas.length) setSel([...data.areas].sort((a, b) => b.stats.count - a.stats.count)[0].id);
  }, [data, sel]);
  if (!data) return <><ErrorNote error={error} />{!error && <div className="skeleton" />}</>;

  return (
    <>
      <ErrorNote error={error} />
      <div className="grid-1-1">
        <div className="stack">
          <Card pad={false}><AreaMap areas={data.areas} height={380} selected={sel} onSelect={setSel} /></Card>
          <Card title={`${data.areas.length} areas`} pad={false}>
            <ul className="area-list">
              {data.areas.map((a) => (
                <li key={a.id}>
                  <button className={sel === a.id ? "on" : ""} onClick={() => setSel(a.id)}>
                    <div><strong>{a.name}</strong><span>{KIND[a.kind] ?? a.kind} · {a.ward}</span></div>
                    <div className="area-right">
                      <span className="mono">{a.stats.count ? `ESI ${a.stats.esi.toFixed(0)}` : "—"}</span>
                      <StatusBadge status={a.stats.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        {sel ? <Detail id={sel} range={range} /> : <Empty>Pick an area.</Empty>}
      </div>
    </>
  );
}
