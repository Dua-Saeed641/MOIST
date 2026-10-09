export type IconName = "inspect" | "truck" | "teach" | "eye" | "check" | "speaker" | "worker" | "map";

const PATHS: Record<IconName, JSX.Element> = {
  inspect: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l5 5" />
      <path d="M11 8v3.5M11 14v.01" />
    </>
  ),
  truck: (
    <>
      <path d="M1.5 6h12v10h-12zM13.5 9h4l3 3v4h-7z" />
      <circle cx="6" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  teach: (
    <>
      <path d="M3 10v4h3l7 4V6L6 10z" />
      <path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  check: <path d="M4 12.5l5.5 5.5L20 6.5" />,
  speaker: (
    <>
      <path d="M3 9v6h4l5 4V5L7 9z" />
      <path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11" />
    </>
  ),
  worker: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21c0-4 3-6 7-6s7 2 7 6" />
    </>
  ),
  map: (
    <>
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
