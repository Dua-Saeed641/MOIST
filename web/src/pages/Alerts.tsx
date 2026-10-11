import { downloadCsv, usePoll, type Range, type Reading } from "../api";
import { Card, Empty, ErrorNote, Icon } from "../components/ui";

const WHY: Record<string, string> = {
  "Probe shorted (metal?)": "The probe read almost zero resistance. Usually a metal can or foil bridging the contacts. The reading is excluded from the statistics.",
  "High gas level": "The gas sensor spiked. Possible decomposing organic waste or chemical contamination. Check the load before routing it.",
};

export default function Alerts({ range }: { range: Range }) {
  const { data, error } = usePoll<{ alerts: Reading[] }>(`/alerts?range=${range}`, 10000);
  if (!data) return <><ErrorNote error={error} />{!error && <div className="skeleton" />}</>;
  const byReason = data.alerts.reduce<Record<string, number>>((m, r) => {
    const k = r.anomaly_reason ?? "Other";
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});

  return (
    <>
      <ErrorNote error={error} />
      <div className="alert-sum">
        {Object.entries(byReason).map(([k, n]) => (
          <div key={k} className="alert-card">
            <span className="alert-n">{n}</span>
            <div><strong>{k}</strong><p>{WHY[k] ?? ""}</p></div>
          </div>
        ))}
        {!data.alerts.length && (
          <div className="alert-card ok"><Icon name="check" /> <div><strong>No exclusions</strong><p>Every reading in this period was used.</p></div></div>
        )}
      </div>
      <Card title="Excluded readings" pad={false} action={
        <button className="btn btn-ghost btn-sm" disabled={!data.alerts.length} onClick={() => downloadCsv("moist-alerts.csv", data.alerts.map((r) => ({
          time: new Date(r.ts).toISOString(), reason: r.anomaly_reason, area: r.area_name, glove: r.device_id, moisture_raw: r.moisture_raw })))}>
          <Icon name="download" size={14} /> Export CSV
        </button>}>
        {data.alerts.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Reason</th><th>Area</th><th>Glove</th><th>Probe raw</th></tr></thead>
              <tbody>
                {data.alerts.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{new Date(r.ts).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td><span className="flag"><Icon name="alert" size={14} />{r.anomaly_reason}</span></td>
                    <td>{r.area_name}</td>
                    <td>{r.device_id}</td>
                    <td className="mono">{r.moisture_raw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No alerts.</Empty>}
      </Card>
    </>
  );
}
