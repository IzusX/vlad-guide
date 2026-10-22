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

function RemoveLeafletPrefix() {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix(false);
  }, [map]);
  return null;
}

function FitBounds({ places }: { places: Place[] }) {
  const map = useMap();
  useEffect(() => {
    if (!places.length) return;
    const frame = window.requestAnimationFrame(() => {
      if (!map.getContainer || !map.getContainer()) return;
      map.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng] as [number, number])), {
        padding: [32, 32],
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [map, places]);
  return null;
}

export function RouteMap({ places }: { places: Place[] }) {
  if (places.length === 0) return null;
  const center: [number, number] = [places[0].lat, places[0].lng];
  const line = places.map((p) => [p.lat, p.lng] as [number, number]);
  const mapKey = places.map((p) => p.id).join("-");

  return (
    <div className="overflow-hidden rounded-2xl border">
      <MapContainer key={mapKey} center={center} zoom={14} style={{ height: 360, width: "100%" }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <RemoveLeafletPrefix />
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
