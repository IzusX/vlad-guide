"use client";

import { useEffect, useRef } from "react";
import type { Place } from "@/lib/types";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export function RouteMap({ places }: { places: Place[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || places.length === 0) return;

    // React 19 Activity + cacheComponents keeps the DOM node alive while hidden.
    // If we are re-mounting for a different route, ensure the previous Leaflet
    // instance tied to this container is fully torn down before creating a new
    // one. Otherwise GridLayer._initContainer will see an uninitialized map pane
    // and throw `Cannot read properties of undefined (reading 'appendChild')`.
    if (mapRef.current) {
      try {
        mapRef.current.remove();
      } catch {
        // Already detached during Suspense/Activity transition.
      }
      mapRef.current = null;
      layerRef.current = null;
    }

    // Leaflet marks the container with `_leaflet_id`. If a previous instance
    // was removed, clear the marker so a fresh map can initialize its panes.
    const containerWithId = container as HTMLElement & { _leaflet_id?: unknown };
    if (containerWithId._leaflet_id != null) {
      delete containerWithId._leaflet_id;
    }
    // Activity may leave detached panes inside the container.
    container.replaceChildren();

    const map = L.map(container, {
      zoomControl: true,
      scrollWheelZoom: false,
    });
    // OSM attribution only — no Leaflet prefix/flag (test expects exactly this text).
    map.attributionControl.setPrefix(false);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerRef.current = layerGroup;

    const latLngs: [number, number][] = places.map((p) => [p.lat, p.lng]);
    L.polyline(latLngs).addTo(layerGroup);

    places.forEach((p, index) => {
      L.marker([p.lat, p.lng], { icon })
        .addTo(layerGroup)
        .bindPopup(`<strong>${index + 1}. ${p.name}</strong><br/>${p.short}`);
    });

    const bounds = L.latLngBounds(latLngs);
    // Defer to next frame so container has layout size (Activity may restore
    // with zero size while offscreen).
    const frame = requestAnimationFrame(() => {
      if (!mapRef.current || mapRef.current !== map) return;
      try {
        // getContainer may be null if Activity hid the subtree between frames.
        const c = map.getContainer();
        if (!c || !c.isConnected) return;
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [32, 32] });
      } catch {
        // Map was removed before the frame fired.
      }
    });

    mapRef.current = map;

    return () => {
      cancelAnimationFrame(frame);
      try {
        map.remove();
      } catch {
        // Ignore removal races during fast navigation.
      }
      if (mapRef.current === map) {
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, [places]);

  if (places.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border">
      <div ref={containerRef} style={{ height: 360, width: "100%" }} className="min-h-[180px] sm:min-h-[240px] md:min-h-[360px] bg-muted" />
    </div>
  );
}
