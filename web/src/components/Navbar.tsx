import { PROJECT_NAME } from "../config";

interface Props {
  statusLabel: string;
  simulated: boolean;
  updatedAt: number;
}

export function Navbar({ statusLabel, simulated, updatedAt }: Props) {
  return (
    <nav className="navbar" aria-label="Primary">
      <a className="brand" href="#top">
        <span className="brand-name">{PROJECT_NAME}</span>
        <span className="brand-sub">Regional waste intelligence</span>
      </a>
      <div className="nav-right">
        <span className="chip" title={simulated ? "No hardware connected yet; readings are simulated" : "Receiving live readings"}>
          <span className="dot" />
          {statusLabel}
        </span>
        <span className="nav-time">Updated {new Date(updatedAt).toLocaleTimeString()}</span>
      </div>
    </nav>
  );
}
