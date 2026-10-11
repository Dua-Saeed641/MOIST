import { useState, type ReactNode } from "react";
import { ago, isSim, usePoll, type Live, type Range } from "../api";
import SkyGradient from "./SkyGradient";
import { Icon, Logo } from "./ui";

export const PAGES = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "live", label: "Live sorting", icon: "activity" },
  { id: "ai", label: "AI assistant", icon: "spark" },
  { id: "energy", label: "Energy planner", icon: "zap" },
  { id: "areas", label: "Areas", icon: "map" },
  { id: "alerts", label: "Alerts", icon: "bell" },
] as const;
export type PageId = (typeof PAGES)[number]["id"];

const ONLINE_MS = 120_000;

function GloveStatus({ live }: { live: Omit<Live, "readings"> | null }) {
  const real = live?.devices.filter((d) => !isSim(d.id)) ?? [];
  const glove = real[0];
  const online = glove && live && live.now - glove.last_seen < ONLINE_MS;
  const gw = usePoll<{ configured: boolean; online?: boolean; glove_connected?: boolean }>("/gateway", 30000).data;
  return (
    <div className="glove-card">
      <SkyGradient className="glove-sky" style={{ aspectRatio: "auto", height: "100%", position: "absolute", inset: 0 }} speed={14} />
      <div className="glove-inner">
        <div className="glove-row">
          <span className={`dot ${online ? "on" : ""}`} />
          <strong>{glove ? glove.id : "No glove connected"}</strong>
        </div>
        <span className="glove-sub">
          {glove && live ? `${online ? "Online" : "Last seen"} · ${ago(glove.last_seen, live.now)} · ${glove.today} today` : "Start the gateway to connect"}
        </span>
        {gw?.configured && (
          <span className="glove-sub">
            Gateway {gw.online ? (gw.glove_connected ? "online · glove plugged in" : "online · glove unplugged") : "offline"}
          </span>
        )}
      </div>
    </div>
  );
}

export default function Shell({ page, range, onRange, live, title, subtitle, children, showRange = true }: {
  page: PageId; range: Range; onRange: (r: Range) => void; live: Omit<Live, "readings"> | null;
  title: string; subtitle: string; children: ReactNode; showRange?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`shell ${open ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <a href="#/" className="side-logo"><Logo /></a>
        <nav>
          {PAGES.map((p) => (
            <a key={p.id} href={`#/app/${p.id}`} className={`nav-item ${page === p.id ? "active" : ""}`} onClick={() => setOpen(false)}>
              <Icon name={p.icon} />
              {p.label}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <GloveStatus live={live} />
          <div className="aws-note"><Icon name="cloud" size={14} /> Serverless on AWS</div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <main className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {showRange && (
            <div className="seg" role="tablist" aria-label="Time range">
              {(["24h", "7d", "30d"] as Range[]).map((r) => (
                <button key={r} role="tab" aria-selected={range === r} className={range === r ? "on" : ""} onClick={() => onRange(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
