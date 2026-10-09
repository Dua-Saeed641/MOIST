export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Sections">
      <a className="side-link active" href="#dashboard" aria-current="page">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="1.5" y="1.5" width="5.5" height="6.5" rx="1" />
          <rect x="9" y="1.5" width="5.5" height="3.5" rx="1" />
          <rect x="1.5" y="10" width="5.5" height="4.5" rx="1" />
          <rect x="9" y="7" width="5.5" height="7.5" rx="1" />
        </svg>
        <span>Dashboard</span>
      </a>
    </aside>
  );
}
