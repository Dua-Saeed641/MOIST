import { useEffect, useState } from "react";
import { ago, downloadCsv, isSim, num, pct, time, type Reading, type useLive } from "../api";
import { Card, ClassPill, Empty, ErrorNote, Icon, MoistureBar } from "../components/ui";

const VERDICT = { dry: "Dry", wet: "Wet", uncertain: "Unsure" } as const;
const ADVICE = {
  dry: "Dry stream. Suitable for refuse-derived fuel.",
  wet: "Wet stream. Compost or biogas.",
  uncertain: "Measure again or set aside for manual sorting.",
} as const;

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

function Latest({ r, now, recent }: { r: Reading; now: number; recent: Reading[] }) {
  return (
    <div key={r.id} className={`latest cls-bg-${r.class} flash`}>
      <div className="latest-top">
        <span className="eyebrow">Latest reading · {ago(r.ts, now)}</span>
        <span className="latest-dev">{r.device_id}{isSim(r.device_id) && <span className="sim">simulated</span>}</span>
      </div>
      <div className="verdict">{VERDICT[r.class]}</div>
      <p className="verdict-sub">{r.anomaly ? `Excluded: ${r.anomaly_reason}` : ADVICE[r.class]}</p>
      <MoistureBar value={r.moisture_score} big />
      <div className="mbar-scale"><span>Dry</span><span>Unsure</span><span>Wet</span></div>
      <dl className="facts">
        <div><dt>Moisture score</dt><dd>{r.moisture_score.toFixed(2)}</dd></div>
        <div><dt>Certainty</dt><dd>{pct(r.certainty)}</dd></div>
        <div><dt>Probe raw</dt><dd>{r.moisture_raw}</dd></div>
        <div><dt>Arm distance</dt><dd>{r.distance_cm != null ? `${r.distance_cm} cm` : "—"}</dd></div>
        <div><dt>Air</dt><dd>{r.air_temp_c != null ? `${r.air_temp_c}°C · ${r.air_rh_pct}%` : "—"}</dd></div>
        <div><dt>Area</dt><dd>{r.area_id}</dd></div>
      </dl>
      <div className="history">
        <span className="eyebrow">Last {recent.length} readings, newest first</span>
        <div className="hist">
          {recent.map((x) => <i key={x.id} className={x.anomaly ? "hist-x" : `cls-${x.class}`} title={`${time(x.ts)} · ${x.class} · ${x.moisture_score.toFixed(2)}`} />)}
        </div>
      </div>
    </div>
  );
}

export default function LivePage({ live }: { live: ReturnType<typeof useLive> }) {
  const now = useNow();
  const [onlyReal, setOnlyReal] = useState(false);
  const rows = onlyReal ? live.readings.filter((r) => !isSim(r.device_id)) : live.readings;
  const t = live.meta?.today;
  const offset = live.meta ? live.meta.now - Date.now() : 0; // server clock vs browser clock
  const nowS = now + offset;
  const split = t && t.checks ? [t.dryShare, 1 - t.dryShare - t.wetShare, t.wetShare] : null;

  return (
    <>
      <ErrorNote error={live.error} />
      <div className="live-head">
        <span className="live-pill"><span className="dot on" /> Live</span>
        <label className="toggle">
          <input type="checkbox" checked={onlyReal} onChange={(e) => setOnlyReal(e.target.checked)} />
          Real glove only
        </label>
      </div>

      <div className="grid-live">
        {rows[0] ? <Latest r={rows[0]} now={nowS} recent={rows.slice(0, 30)} /> : (
          <div className="latest cls-bg-none">
            <span className="eyebrow">Waiting for the first reading</span>
            <div className="verdict muted">—</div>
            <p className="verdict-sub">Hold the glove about 12 cm above an item until the display reads 10. The probe arm takes the reading and it appears here.</p>
          </div>
        )}

        <div className="stack">
          <Card title="Last 24 hours">
            {t && split ? (
              <>
                <div className="today-num">{num(t.checks)}<span>readings</span></div>
                <div className="split" aria-label="Dry, unsure, wet split">
                  <i className="cls-dry" style={{ flex: split[0] }} />
                  <i className="cls-uncertain" style={{ flex: Math.max(0, split[1]) }} />
                  <i className="cls-wet" style={{ flex: split[2] }} />
                </div>
                <div className="split-legend">
                  <span><i className="cls-dry" />Dry {pct(split[0])}</span>
                  <span><i className="cls-uncertain" />Unsure {pct(Math.max(0, split[1]))}</span>
                  <span><i className="cls-wet" />Wet {pct(split[2])}</span>
                </div>
              </>
            ) : <Empty>No readings in the last 24 hours.</Empty>}
          </Card>
          <Card title="Gloves">
            {live.meta?.devices.length ? (
              <ul className="devices">
                {live.meta.devices.map((d) => {
                  const on = live.meta!.now - d.last_seen < 120_000;
                  return (
                    <li key={d.id}>
                      <span className={`dot ${on ? "on" : ""}`} />
                      <div>
                        <strong>{d.id}</strong>{isSim(d.id) && <span className="sim">simulated</span>}
                        <span>{d.area_id} · {d.today} today</span>
                      </div>
                      <span className="muted">{ago(d.last_seen, nowS)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <Empty>No glove has reported in 24 hours.</Empty>}
          </Card>
        </div>
      </div>

      <Card title="Recent readings" pad={false} action={
        <button className="btn btn-ghost btn-sm" disabled={!rows.length} onClick={() => downloadCsv("moist-readings.csv", rows.map((r) => ({
          time: new Date(r.ts).toISOString(), class: r.class, moisture_score: r.moisture_score, certainty: r.certainty,
          moisture_raw: r.moisture_raw, area: r.area_id, glove: r.device_id, excluded: r.anomaly_reason ?? "" })))}>
          <Icon name="download" size={14} /> Export CSV
        </button>}>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Time</th><th>Result</th><th>Moisture</th><th>Certainty</th><th>Area</th><th>Glove</th><th>Flag</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((r) => (
                  <tr key={r.id} className="row-in">
                    <td className="mono">{time(r.ts)}</td>
                    <td><ClassPill cls={r.class} /></td>
                    <td><div className="cell-bar"><MoistureBar value={r.moisture_score} /><span className="mono">{r.moisture_score.toFixed(2)}</span></div></td>
                    <td className="mono">{pct(r.certainty)}</td>
                    <td>{r.area_id}</td>
                    <td>{r.device_id}{isSim(r.device_id) && <span className="sim">sim</span>}</td>
                    <td>{r.anomaly ? <span className="flag"><Icon name="alert" size={14} />{r.anomaly_reason}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Readings will appear here.</Empty>}
      </Card>
    </>
  );
}
