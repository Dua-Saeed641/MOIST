import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num, pct, usePoll, type Overview as O, type Range } from "../api";
import AreaMap from "../components/AreaMap";
import glove from "../assets/glove.webp";
import { Card, Delta, Empty, ErrorNote, Icon, Kpi, StatusBadge } from "../components/ui";
import BriefCard from "./BriefCard";

export function tickLabel(t: number, range: Range) {
  const d = new Date(t);
  return range === "24h" ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function TrendChart({ data, range, height = 260 }: { data: O["trend"]; range: Range; height?: number }) {
  const rows = data.map((p) => ({ ...p, label: tickLabel(p.t, range), dryPct: p.dryShare == null ? null : p.dryShare * 100,
    moistPct: p.meanMoisture == null ? null : p.meanMoisture * 100 }));
  return (
    <div className="fill" style={{ minHeight: height, position: "relative" }}>
    <ResponsiveContainer width="100%" height="100%" minHeight={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="gDry" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D39A3A" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#D39A3A" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gWet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2F6F9F" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#2F6F9F" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(12,42,54,.06)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6F8A93" }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#6F8A93" }} tickLine={false} axisLine={false} unit="%" />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid rgba(12,42,54,.08)", boxShadow: "0 8px 24px rgba(12,42,54,.08)", fontSize: 12 }}
          formatter={(v: number, name: string) => [`${v.toFixed(0)}%`, name]}
        />
        <Area type="monotone" dataKey="dryPct" name="Dry share" stroke="#C98A2B" strokeWidth={2} fill="url(#gDry)" connectNulls />
        <Area type="monotone" dataKey="moistPct" name="Mean moisture" stroke="#2F6F9F" strokeWidth={2} fill="url(#gWet)" connectNulls />
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}

function SectionHead({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div className="section-head">
      <span className="section-n">{n}</span>
      <div><h2>{title}</h2><p>{sub}</p></div>
    </div>
  );
}

export default function Overview({ range }: { range: Range }) {
  const { data, error } = usePoll<O>(`/overview?range=${range}`, 15000);
  if (!data) return <><ErrorNote error={error} />{!error && <div className="skeleton" />}</>;
  const { kpis: k, previous: p } = data;
  const rated = data.areas.filter((a) => a.stats.count);
  const pickup = rated.filter((a) => a.stats.status === "pickup");
  const top = [...rated].sort((a, b) => b.stats.esi - a.stats.esi).slice(0, 5);
  const span = range === "24h" ? "Last 24 hours" : range === "7d" ? "Last 7 days" : "Last 30 days";

  return (
    <>
      <ErrorNote error={error} />
      <section className="intro">
        <div className="intro-text">
          <span className="eyebrow">What MØIST does</span>
          <h2>Gloves check every item for moisture. This dashboard turns those readings into collection decisions.</h2>
          <ol className="intro-steps">
            <li><Icon name="glove" size={18} /><div><strong>Measure</strong><span>A probe on the glove reads each item: wet, dry or unsure.</span></div></li>
            <li><Icon name="cloud" size={18} /><div><strong>Score</strong><span>AWS rates each collection point (ESI); Claude on Bedrock explains it.</span></div></li>
            <li><Icon name="factory" size={18} /><div><strong>Act</strong><span>Dry points go to the energy plant; wet ones get a segregation drive.</span></div></li>
          </ol>
        </div>
        <img className="intro-glove" src={glove} alt="MØIST glove prototype" />
      </section>

      <div className="status-line">
        <span className="eyebrow">{span}</span>
        <p>
          {k.checks ? <><strong>{pct(k.dryShare)} of items checked were dry.</strong>{" "}
            {pickup.length ? `${pickup.length} collection ${pickup.length === 1 ? "point is" : "points are"} ready for direct transport to the energy plant.` : "No collection point meets the pickup threshold yet."}</>
            : "No readings in this period."}
        </p>
        <a href="#/app/energy" className="btn btn-dark btn-sm">View energy planner <Icon name="arrow" size={15} /></a>
      </div>

      <SectionHead n="1" title="Segregation quality" sub="What the gloves measured across all collection points in this period." />
      <div className="kpis">
        <Kpi icon="activity" label="Items checked" value={num(k.checks)} delta={<Delta now={k.checks} before={p.checks} unit="%" />} />
        <Kpi icon="drop" label="Dry share" value={pct(k.dryShare)} delta={<Delta now={k.dryShare} before={p.dryShare} />} />
        <Kpi icon="zap" label="Energy Suitability Index" value={k.esi.toFixed(0)} hint="0–100, weighted by readings"
          delta={<Delta now={k.esi / 100} before={p.esi / 100} />} />
        <Kpi icon="glove" label="Gloves reporting" value={k.gloves} delta={<span className="delta flat">{k.areas} collection points</span>} />
        <Kpi icon="alert" label="Excluded readings" value={num(k.anomalies)} delta={<Delta now={k.anomalies} before={p.anomalies} invert unit="%" />} />
      </div>

      <div className="grid-2-1">
        <Card title="Dry share and moisture over time" sub="Higher dry share and lower moisture mean better segregation." action={<span className="legend"><i className="lg-dry" />Dry share<i className="lg-wet" />Mean moisture</span>}>
          {k.checks ? <TrendChart data={data.trend} range={range} /> : <Empty>No readings in this period.</Empty>}
        </Card>
        <BriefCard initial={data.brief} />
      </div>

      <SectionHead n="2" title="Energy recovery" sub="Where the dry, burnable waste is, and what to do at each collection point." />
      <div className="grid-2-1">
        <Card title="Collection points" sub="Colour shows ESI. Click a point for details." pad={false}>
          <AreaMap areas={data.areas} height={340} onSelect={(id) => { window.location.hash = `#/app/areas?${id}`; }} />
        </Card>
        <Card title="Highest ESI" sub="Driest waste, best for refuse-derived fuel." action={<a className="link" href="#/app/energy">All areas</a>}>
          {top.length ? (
            <ol className="rank-list">
              {top.map((a) => (
                <li key={a.id}>
                  <span className="rank-n">{a.rank}</span>
                  <div className="rank-main">
                    <strong>{a.name}</strong>
                    <span>{pct(a.stats.dryShare)} dry · {a.stats.count} readings</span>
                  </div>
                  <div className="rank-side">
                    <span className="esi">{a.stats.esi.toFixed(0)}</span>
                    <StatusBadge status={a.stats.status} />
                  </div>
                </li>
              ))}
            </ol>
          ) : <Empty>No rated areas yet.</Empty>}
        </Card>
      </div>
    </>
  );
}
