import type { ReactNode } from "react";
import { STATUS, type Status, type WasteClass } from "../api";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Activity01Icon, Alert02Icon, ArrowDownRight01Icon, ArrowRight02Icon, ArrowUpRight01Icon, CheckmarkCircle02Icon,
  CloudIcon, DashboardSquare01Icon, Download04Icon, DropletIcon, FlashIcon, Factory01Icon, GloveIcon, Location01Icon,
  MapsIcon, Menu01Icon, Notification03Icon, Refresh01Icon, SparklesIcon, Wifi01Icon,
} from "@hugeicons/core-free-icons";

const ICONS = {
  grid: DashboardSquare01Icon,
  activity: Activity01Icon,
  zap: FlashIcon,
  map: MapsIcon,
  bell: Notification03Icon,
  arrow: ArrowRight02Icon,
  spark: SparklesIcon,
  refresh: Refresh01Icon,
  drop: DropletIcon,
  glove: GloveIcon,
  check: CheckmarkCircle02Icon,
  alert: Alert02Icon,
  cloud: CloudIcon,
  pin: Location01Icon,
  menu: Menu01Icon,
  up: ArrowUpRight01Icon,
  down: ArrowDownRight01Icon,
  download: Download04Icon,
  factory: Factory01Icon,
  wifi: Wifi01Icon,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <HugeiconsIcon icon={ICONS[name]} size={size} strokeWidth={1.6} color="currentColor" aria-hidden="true" />;
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`logo ${light ? "logo-light" : ""}`}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="15" fill="currentColor" opacity=".14" />
        <path d="M16 6c4.4 5.2 6.6 8.6 6.6 11.8a6.6 6.6 0 0 1-13.2 0C9.4 14.6 11.6 11.2 16 6z" fill="currentColor" />
      </svg>
      MØIST
    </span>
  );
}

export function Card({ title, sub, action, children, className = "", pad = true }:
  { title?: ReactNode; sub?: string; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          <div><h3>{title}</h3>{sub && <p className="card-sub">{sub}</p>}</div>
          {action}
        </header>
      )}
      <div className={pad ? "card-body" : ""}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, delta, icon, hint }:
  { label: string; value: ReactNode; delta?: ReactNode; icon: IconName; hint?: string }) {
  return (
    <div className="kpi" title={hint}>
      <div className="kpi-top">
        <span className="kpi-icon"><Icon name={icon} size={16} /></span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-delta">{delta}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return <span className={`badge tone-${s.tone}`}>{s.label}</span>;
}

export function ClassPill({ cls }: { cls: WasteClass }) {
  return <span className={`pill cls-${cls}`}>{cls === "uncertain" ? "Unsure" : cls === "dry" ? "Dry" : "Wet"}</span>;
}

/** 0 dry .. 1 wet, with the 0.38 / 0.62 class cut-offs marked. */
export function MoistureBar({ value, big = false }: { value: number; big?: boolean }) {
  return (
    <div className={`mbar ${big ? "mbar-big" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={value}
      aria-label="Moisture score">
      <div className="mbar-zone dry" style={{ width: "38%" }} />
      <div className="mbar-zone unc" style={{ width: "24%" }} />
      <div className="mbar-zone wet" style={{ width: "38%" }} />
      <div className="mbar-mark" style={{ left: `${value * 100}%` }} />
    </div>
  );
}

export function Delta({ now, before, invert = false, unit = "pp" }: { now: number; before: number; invert?: boolean; unit?: "pp" | "%" }) {
  if (!before) return null;
  const d = unit === "pp" ? (now - before) * 100 : ((now - before) / before) * 100;
  if (Math.abs(d) < 0.5) return <span className="delta flat">steady</span>;
  const up = d > 0;
  return (
    <span className={`delta ${up !== invert ? "good" : "bad"}`}>
      <Icon name={up ? "up" : "down"} size={13} />
      {Math.abs(d).toFixed(0)}{unit === "pp" ? " pts" : "%"}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error-note"><Icon name="alert" size={16} /> Can't reach the API ({error}). Retrying…</div>;
}
