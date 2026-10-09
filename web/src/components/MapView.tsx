import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { AreaMetrics, Status } from "../types";
import { STATUS_META, STATUS_ORDER, Shape } from "./Status";

// Basemap tiles. Defaults to OpenStreetMap (no key). Set VITE_MAP_TILE_URL (+ VITE_MAP_ATTRIBUTION) to use a keyed provider,
// e.g. MapTiler: https://api.maptiler.com/maps/dataviz-light/{z}/{x}/{y}.png?key=YOUR_KEY
const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  (import.meta.env.VITE_MAP_ATTRIBUTION as string) || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const SHAPES: Record<Status, string> = {
  red: '<polygon points="18,3 34,32 2,32"',
  amber: '<polygon points="18,2 34,18 18,34 2,18"',
  green: '<circle cx="18" cy="18" r="15"',
  blue: '<rect x="4" y="4" width="28" height="28" rx="6"',
};

function iconFor(status: Status, esi: number, selected: boolean) {
  const { color, ink } = STATUS_META[status];
  const ty = status === "red" ? 26 : 23;
  const html = `<div class="mk ${selected ? "sel" : ""}">
    <svg width="38" height="38" viewBox="0 0 36 36">${SHAPES[status]} fill="${color}" stroke="#fff" stroke-width="2"/>
    <text x="18" y="${ty}" text-anchor="middle" font-size="13" font-weight="700" fill="${ink}">${Math.round(esi)}</text></svg></div>`;
  return L.divIcon({ html, className: "mk-wrap", iconSize: [38, 38], iconAnchor: [19, 19] });
}

function ViewportWatcher({ onBounds }: { onBounds: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({
    moveend: () => onBounds(map.getBounds()),
    zoomend: () => onBounds(map.getBounds()),
  });
  useEffect(() => onBounds(map.getBounds()), [map, onBounds]);
  return null;
}

function Controller({ metrics, selectedId, resetNonce }: { metrics: AreaMetrics[]; selectedId: string | null; resetNonce: number }) {
  const map = useMap();
  const first = useRef(true);
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  useEffect(() => {
    const pts = metricsRef.current.map((m) => [m.area.lat, m.area.lon] as [number, number]);
    if (pts.length === 0) return;
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], animate: !first.current });
    first.current = false;
  }, [map, resetNonce, metrics.length > 0]);

  useEffect(() => {
    if (!selectedId) return;
    const m = metricsRef.current.find((x) => x.area.id === selectedId);
    if (!m) return;
    const ll = L.latLng(m.area.lat, m.area.lon);
    if (!map.getBounds().pad(-0.15).contains(ll)) map.flyTo(ll, Math.max(map.getZoom(), 12), { duration: 0.8 });
  }, [map, selectedId]);

  return null;
}

interface Props {
  metrics: AreaMetrics[];
  visibleIds: Set<string>;
  selectedId: string | null;
  resetNonce: number;
  onSelect: (id: string) => void;
  onBounds: (b: L.LatLngBounds) => void;
}

export function MapView({ metrics, visibleIds, selectedId, resetNonce, onSelect, onBounds }: Props) {
  const center = useMemo<[number, number]>(() => [28.65, 77.15], []);
  return (
    <div className="map-shell">
      <MapContainer center={center} zoom={10} className="map" scrollWheelZoom>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        <ViewportWatcher onBounds={onBounds} />
        <Controller metrics={metrics} selectedId={selectedId} resetNonce={resetNonce} />
        {metrics.map((m) => (
          <Marker
            key={m.area.id}
            position={[m.area.lat, m.area.lon]}
            icon={iconFor(m.status, m.esi, m.area.id === selectedId)}
            opacity={visibleIds.has(m.area.id) ? 1 : 0.5}
            zIndexOffset={m.area.id === selectedId ? 1000 : m.status === "red" ? 500 : 0}
            eventHandlers={{ click: () => onSelect(m.area.id) }}
          >
            <Tooltip direction="top" offset={[0, -16]}>
              {m.area.name} · {STATUS_META[m.status].label} · ESI {m.esi.toFixed(0)}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
      <div className="legend" aria-label="Map legend">
        {STATUS_ORDER.map((s) => (
          <span key={s}>
            <Shape status={s} /> {STATUS_META[s].label}
          </span>
        ))}
        <span className="legend-note">Number = ESI</span>
      </div>
    </div>
  );
}
