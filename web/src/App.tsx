import { useEffect, useState } from "react";
import { useLive, type Range } from "./api";
import Shell, { PAGES, type PageId } from "./components/Shell";
import Alerts from "./pages/Alerts";
import Areas from "./pages/Areas";
import Assistant from "./pages/Assistant";
import Energy from "./pages/Energy";
import Landing from "./pages/Landing";
import LivePage from "./pages/Live";
import Overview from "./pages/Overview";

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => { setHash(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

const HEAD: Record<PageId, [string, string]> = {
  overview: ["Overview", "Segregation quality and energy potential by collection point"],
  live: ["Live sorting", "Readings as they arrive from each glove"],
  ai: ["AI assistant", "Claude on Amazon Bedrock explains the numbers and answers questions"],
  energy: ["Energy planner", "Energy Suitability Index and recommended action by collection point"],
  areas: ["Areas", "Collection points, transfer stations and colonies"],
  alerts: ["Alerts", "Readings excluded from the statistics"],
};

function Dashboard({ page }: { page: PageId }) {
  const [range, setRange] = useState<Range>(() => {
    try { return (localStorage.getItem("moist-range") as Range) || "7d"; } catch { return "7d"; }
  });
  const onRange = (r: Range) => {
    setRange(r);
    try { localStorage.setItem("moist-range", r); } catch { /* private mode */ }
  };
  const live = useLive(2000);
  const [title, subtitle] = HEAD[page];
  return (
    <Shell page={page} range={range} onRange={onRange} live={live.meta} title={title} subtitle={subtitle} showRange={page !== "live"}>
      {page === "overview" && <Overview range={range} />}
      {page === "live" && <LivePage live={live} />}
      {page === "ai" && <Assistant range={range} />}
      {page === "energy" && <Energy range={range} />}
      {page === "areas" && <Areas range={range} />}
      {page === "alerts" && <Alerts range={range} />}
    </Shell>
  );
}

export default function App() {
  const hash = useHash();
  const m = hash.match(/^#\/app\/?(\w+)?/);
  if (!m) return <Landing />;
  const page = (PAGES.find((p) => p.id === m[1])?.id ?? "overview") as PageId;
  return <Dashboard page={page} />;
}
