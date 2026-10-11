import { useState } from "react";
import { api, ago, usePoll, type Overview, type Range } from "../api";
import { Card, Icon } from "../components/ui";
import BriefCard from "./BriefCard";

interface Answer { question: string; answer: string; model: string; generated: number }

const SUGGESTED = [
  "Which collection points should go to the energy plant this week?",
  "Where is segregation getting worse?",
  "Which area needs a segregation drive first, and why?",
  "Are any gloves giving faulty readings?",
];

/** Claude on Amazon Bedrock: the morning brief, plus free-text questions about the computed numbers. */
export default function Assistant({ range }: { range: Range }) {
  const { data } = usePoll<Overview>(`/overview?range=${range}`, 0);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Answer[]>([]);

  const ask = async (question: string) => {
    if (busy || question.trim().length < 3) return;
    setBusy(true);
    setErr(null);
    try {
      const a = await api<Answer>("/ask", { method: "POST", body: JSON.stringify({ question, range }) });
      setHistory((h) => [a, ...h]);
      setQ("");
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <div className="ai-hero">
        <span className="ai-badge"><Icon name="spark" size={14} /> Claude on Amazon Bedrock</span>
        <h2>Ask about your collection points</h2>
        <p>
          Claude reads the figures MØIST has already computed for the selected period (dry share, moisture, ESI and status
          for every collection point) and answers in plain language. It explains the numbers; it never classifies waste itself.
        </p>
        <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="e.g. Which area should get a segregation drive first?" aria-label="Question" />
          <button className="btn btn-dark" disabled={busy || q.trim().length < 3}>{busy ? "Thinking…" : <>Ask <Icon name="arrow" size={15} /></>}</button>
        </form>
        <div className="chips">
          {SUGGESTED.map((s) => <button key={s} className="chip" onClick={() => ask(s)} disabled={busy}>{s}</button>)}
        </div>
        {err && <div className="error-note">{err}</div>}
      </div>

      <div className="grid-2-1">
        <Card title="Answers" sub={data ? `Based on ${data.kpis.checks.toLocaleString("en-IN")} readings from ${data.kpis.areas} collection points` : undefined}>
          {history.length ? (
            <ul className="answers">
              {history.map((a) => (
                <li key={a.generated}>
                  <strong>{a.question}</strong>
                  <p>{a.answer}</p>
                  <span className="muted small">{a.model} · {ago(a.generated)}</span>
                </li>
              ))}
            </ul>
          ) : <div className="empty">Ask a question or pick one of the suggestions above.</div>}
        </Card>
        <BriefCard initial={data?.brief ?? null} />
      </div>
    </>
  );
}
