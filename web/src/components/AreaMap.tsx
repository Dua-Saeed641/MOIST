import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import type { Area } from "../api";
import { pct } from "../api";

/** ESI 0..100 -> wet blue .. teal .. sand (energy-grade). */
export function esiColor(esi: number, count: number) {
  if (!count) return "#9AAEB5";
  if (esi >= 70) return "#D39A3A";
  if (esi >= 55) return "#3FA79A";
  return "#2F6F9F";
}

export default function AreaMap({ areas, height = 320, selected, onSelect }:
  { areas: Area[]; height?: number; selected?: string | null; onSelect?: (id: string) => void }) {
  const pts = areas.filter((a) => a.lat && a.lon);
  const view = pts.length > 1
    ? { bounds: pts.map((a) => [a.lat, a.lon] as [number, number]), boundsOptions: { padding: [36, 36] as [number, number] } }
    : { center: (pts[0] ? [pts[0].lat, pts[0].lon] : [28.61, 77.21]) as [number, number], zoom: 12 };
  return (
    <div className="map fill" style={{ minHeight: height }}>
      <MapContainer {...view} scrollWheelZoom={false} style={{ position: "absolute", inset: 0 }}>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {pts.map((a) => (
          <CircleMarker
            key={a.id}
            center={[a.lat, a.lon]}
            radius={8 + Math.min(14, Math.sqrt(a.stats.count) * 0.9)}
            pathOptions={{
              color: selected === a.id ? "#0C2A36" : "#fff",
              weight: selected === a.id ? 3 : 2,
              fillColor: esiColor(a.stats.esi, a.stats.count),
              fillOpacity: 0.85,
            }}
            eventHandlers={{ click: () => onSelect?.(a.id) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <strong>{a.name}</strong>
              <br />
              {a.stats.count ? `ESI ${a.stats.esi.toFixed(0)} · ${pct(a.stats.dryShare)} dry · ${a.stats.count} checks` : "No checks yet"}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="map-legend">
        <span><i style={{ background: "#D39A3A" }} />ESI 70+</span>
        <span><i style={{ background: "#3FA79A" }} />55–70</span>
        <span><i style={{ background: "#2F6F9F" }} />below 55</span>
      </div>
    </div>
  );
}
