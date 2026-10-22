"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { PlaceCard } from "@/components/PlaceCard";
import { Chat } from "@/components/Chat";
import type { Place, Route } from "@/lib/types";

const RouteMap = dynamic(() => import("@/components/Map").then((m) => m.RouteMap), { ssr: false });

export function RouteClient({ route, places }: { route: Route; places: Place[] }) {
  const [active, setActive] = useState<Place | null>(places[0] ?? null);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3 space-y-4">
        <RouteMap places={places} />
        <div className="space-y-3">
          {places.map((p, i) => (
            <PlaceCard key={p.id} place={p} index={i} onAsk={setActive} />
          ))}
        </div>
      </div>
      <div className="lg:col-span-2">
        <div className="sticky top-[64px] space-y-4">
          <div className="rounded-2xl border bg-card p-4">
            <h1 className="text-lg font-medium leading-tight">{route.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{route.summary}</p>
            <div className="mt-2 text-xs text-muted-foreground">
              {places.length} точек · {route.duration === "1h" ? "1 час" : route.duration === "2h" ? "2 часа" : "Полдня"}
            </div>
          </div>
          <Chat place={active} />
        </div>
      </div>
    </div>
  );
}
