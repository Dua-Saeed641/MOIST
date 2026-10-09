import type L from "leaflet";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Analytics } from "./components/Analytics";
import { AreaPanel } from "./components/AreaPanel";
import { Hero } from "./components/Hero";
import { LiveFeed } from "./components/LiveFeed";
import { MapView } from "./components/MapView";
import { Navbar } from "./components/Navbar";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { WorkerView } from "./components/WorkerView";
import { Icon } from "./components/Icon";
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, EsiWeights, RANGES, RangeKey, Thresholds } from "./config";
import { HttpDataSource } from "./data/http";
import { SampleDataSource } from "./data/sample";
import type { DataSource } from "./data/source";
import { computeMetrics } from "./lib/metrics";
import type { ActionState, Area, Reading } from "./types";

// VITE_API_URL set -> talk to the MOIST API (local server or AWS). Unset -> simulated data.
const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const source: DataSource = API_URL
  ? new HttpDataSource(API_URL, import.meta.env.VITE_API_KEY as string | undefined)
  : new SampleDataSource();

export default function App() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [range, setRange] = useState<RangeKey>("7d");
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [weights, setWeights] = useState<EsiWeights>(DEFAULT_WEIGHTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [view, setView] = useState<"work" | "insights">("work");
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    Promise.all([source.loadAreas(), source.loadReadings(), source.loadActions?.() ?? Promise.resolve({})]).then(([as, rs, acts]) => {
      if (cancelled) return;
      setAreas(as);
      setActionStates(acts);
      setReadings(rs);
      setNow(Date.now());
      off = source.subscribe((r) => {
        setReadings((prev) => [...prev, r]);
        setNow(r.ts);
      });
    }).catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  const rangeMs = RANGES.find((r) => r.key === range)!.ms;
  const start = now - rangeMs;

  const metrics = useMemo(
    () => computeMetrics(areas, readings, start, now, thresholds, weights),
    [areas, readings, start, now, thresholds, weights],
  );

  const visible = useMemo(
    () => (bounds ? metrics.filter((m) => bounds.contains([m.area.lat, m.area.lon])) : metrics),
    [metrics, bounds],
  );
  const visibleIds = useMemo(() => new Set(visible.map((m) => m.area.id)), [visible]);
  const isFiltered = visible.length < metrics.length;

  const selected = metrics.find((m) => m.area.id === selectedId) ?? null;
  const rankInView = useMemo(() => {
    if (!selected || !visibleIds.has(selected.area.id)) return null;
    return [...visible].sort((a, b) => b.esi - a.esi).findIndex((m) => m.area.id === selected.area.id) + 1;
  }, [visible, visibleIds, selected]);

  const onBounds = useCallback((b: L.LatLngBounds) => setBounds(b), []);
  const setState = (key: string, s: ActionState) => {
    setActionStates((p) => ({ ...p, [key]: s }));
    source.saveAction?.(key, s).catch(() => setError("Could not save action status"));
  };
  const hourly = range === "24h";

  const actionKey = (m: { area: { id: string }; recommendation: { type: string } }) => `${m.area.id}:${m.recommendation.type}`;

  return (
    <>
      <Navbar statusLabel={source.label} simulated={source.isSimulated} updatedAt={now} />
      <Hero />
      <div className="shell">
        <Sidebar />
        <main id="dashboard">
          <div className="view-switch" role="tablist" aria-label="Dashboard sections">
            <button role="tab" aria-selected={view === "work"} className={view === "work" ? "on" : ""} onClick={() => setView("work")}>
              <Icon name="worker" size={22} />
              <span>
                My work<small>आज का काम</small>
              </span>
            </button>
            <button role="tab" aria-selected={view === "insights"} className={view === "insights" ? "on" : ""} onClick={() => setView("insights")}>
              <Icon name="map" size={22} />
              <span>
                Region insights<small>इलाके की जानकारी</small>
              </span>
            </button>
          </div>

          {error && <div className="errbar" role="alert">{error}</div>}
          {areas.length === 0 && !error && <p className="muted pad">Loading...</p>}

          {view === "work" ? (
            <WorkerView
              metrics={metrics}
              states={actionStates}
              onState={setState}
              onShowOnMap={(id) => {
                setSelectedId(id);
                setView("insights");
              }}
            />
          ) : (
            <>
              <TopBar
                range={range}
                onRange={setRange}
                metrics={metrics}
                thresholds={thresholds}
                weights={weights}
                onConfig={(t, w) => {
                  setThresholds(t);
                  setWeights(w);
                }}
              />

              <div className="workspace">
                <MapView
                  metrics={metrics}
                  visibleIds={visibleIds}
                  selectedId={selectedId}
                  resetNonce={resetNonce}
                  onSelect={setSelectedId}
                  onBounds={onBounds}
                />
                <AreaPanel
                  metric={selected}
                  total={metrics.length}
                  inView={visible.length}
                  rankInView={rankInView}
                  actionState={selected ? actionStates[actionKey(selected)] ?? "open" : "open"}
                  onActionState={(s) => selected && setState(actionKey(selected), s)}
                  onClose={() => setSelectedId(null)}
                />
              </div>

              <Analytics
                metrics={metrics}
                visible={visible}
                isFiltered={isFiltered}
                readings={readings}
                start={start}
                end={now}
                hourly={hourly}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onReset={() => setResetNonce((n) => n + 1)}
              />

              <LiveFeed readings={readings} metrics={metrics} onSelect={setSelectedId} />
            </>
          )}

          <footer className="foot">Sample data is simulated for demonstration. Hardware readings plug in through the same data source.</footer>
        </main>
      </div>
    </>
  );
}
