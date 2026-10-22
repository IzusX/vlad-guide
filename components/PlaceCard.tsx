"use client";
import type { Place } from "@/lib/types";

export function PlaceCard({
  place,
  index,
  onAsk,
}: {
  place: Place;
  index: number;
  onAsk: (place: Place) => void;
}) {
  return (
    <div className="flex gap-4 rounded-2xl border bg-card p-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium leading-tight">{place.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{place.address}</p>
        <p className="mt-2 text-sm leading-6 text-foreground/80">{place.short}</p>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{place.description}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {place.category.map((c) => (
            <span key={c} className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">
              {c}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => onAsk(place)}
            className="inline-flex items-center justify-center rounded-4xl border border-transparent bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 text-center leading-none transition-colors"
          >
            Спросить ИИ-гида
          </button>
          <a
            href={`https://2gis.ru/vladivostok/search/${encodeURIComponent(place.name)}`}
            target="_blank"
            className="inline-flex items-center justify-center rounded-4xl border px-4 py-2 text-sm hover:bg-muted/30 text-center leading-none transition-colors"
          >
            Открыть в 2ГИС
          </a>
        </div>
      </div>
    </div>
  );
}
