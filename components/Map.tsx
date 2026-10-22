"use client";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import type { Place } from "@/lib/types";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix default marker icons for Next.js
// Use CDN icons to avoid bundling issues
const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function FitBounds({ places }: { places: Place[] }) {
  const map = useMap();
  useEffect(() => {
    if (places.length === 0) return;
    const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [map, places]);
  return null;
}

export function RouteMap({ places }: { places: Place[] }) {
  if (places.length === 0) return null;
  const center: [number, number] = [places[0].lat, places[0].lng];
  const line = places.map((p) => [p.lat, p.lng] as [number, number]);

  return (
    <div className="overflow-hidden rounded-2xl border">
      <MapContainer center={center} zoom={14} style={{ height: 360, width: "100%" }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={line} />
        {places.map((p, i) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={icon}>
            <Popup>
              <strong>
                {i + 1}. {p.name}
              </strong>
              <br />
              {p.short}
            </Popup>
          </Marker>
        ))}
        <FitBounds places={places} />
      </MapContainer>
    </div>
  );
}
