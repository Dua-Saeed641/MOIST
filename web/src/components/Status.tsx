import type { Status } from "../types";

/** Colour AND shape AND label, so status never relies on colour alone. */
export const STATUS_META: Record<Status, { color: string; ink: string; label: string; meaning: string }> = {
  red: { color: "#dc2626", ink: "#fff", label: "High priority", meaning: "Immediate attention" },
  amber: { color: "#f59e0b", ink: "#1f2937", label: "Moderate", meaning: "Monitor or schedule" },
  green: { color: "#16a34a", ink: "#fff", label: "Normal", meaning: "Low priority" },
  blue: { color: "#2563eb", ink: "#fff", label: "Wet-dominant", meaning: "Very low dry fraction" },
};

export const STATUS_ORDER: Status[] = ["red", "amber", "blue", "green"];

export function Shape({ status, size = 14 }: { status: Status; size?: number }) {
  const c = STATUS_META[status].color;
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" style={{ flex: "none" }}>
      {status === "red" && <polygon points="18,3 34,32 2,32" fill={c} />}
      {status === "amber" && <polygon points="18,2 34,18 18,34 2,18" fill={c} />}
      {status === "green" && <circle cx="18" cy="18" r="15" fill={c} />}
      {status === "blue" && <rect x="4" y="4" width="28" height="28" rx="6" fill={c} />}
    </svg>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className="badge" style={{ borderColor: STATUS_META[status].color }}>
      <Shape status={status} />
      {STATUS_META[status].label}
    </span>
  );
}
