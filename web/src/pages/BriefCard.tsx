import { useEffect, useState } from "react";
import { ago, api, type Brief } from "../api";
import { Card, Icon } from "../components/ui";

/** The morning dispatch brief, written by Claude on Amazon Bedrock from the computed area numbers. */
export default function BriefCard({ initial }: { initial: Brief | null }) {
  const [brief, setBrief] = useState<Brief | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (initial) setBrief(initial);
    else api<Brief>("/brief").then(setBrief).catch(() => {});
  }, [initial]);

  const regenerate = async () => {
    setBusy(true);
    setErr(null);
    try { setBrief(await api<Brief>("/brief", { method: "POST" })); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const lines = brief?.text.split("\n").filter(Boolean) ?? [];
  return (
    <Card
      className="brief"
      title={<span className="brief-title"><Icon name="spark" size={16} /> Morning brief <span className="ai-tag">AI</span></span>}
      action={<button className="btn btn-ghost btn-sm" onClick={regenerate} disabled={busy}>
        <Icon name="refresh" size={14} /> {busy ? "Writing…" : "Regenerate"}
      </button>}
    >
      {brief ? (
        <>
          <div className={`brief-text ${busy ? "busy" : ""}`}>
            {lines.map((l, i) => l.startsWith("- ") ? <p key={i} className="brief-item">{l.slice(2)}</p> : <p key={i}>{l}</p>)}
          </div>
          <div className="brief-meta">
            {brief.source === "bedrock" ? <>Written by Claude on Amazon Bedrock</> : <>Rule-based summary (Bedrock not connected)</>}
            {" · "}{ago(brief.generated)}
          </div>
        </>
      ) : <div className="skeleton small" />}
      {err && <div className="error-note">{err}</div>}
    </Card>
  );
}
