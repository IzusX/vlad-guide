import Link from "next/link";
import type { Route } from "@/lib/types";

const durationLabel: Record<Route["duration"], string> = {
  "1h": "1 час",
  "2h": "2 часа",
  "4h": "Полдня",
};

export function RouteCard({ route }: { route: Route }) {
  return (
    <Link
      href={`/routes/${route.id}`}
      className="group flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition hover:shadow-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
          {durationLabel[route.duration]}
        </span>
        <span className="text-xs text-muted-foreground">{route.placeIds.length} точек</span>
      </div>
      <h3 className="text-lg font-medium leading-tight group-hover:underline">{route.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-muted-foreground">{route.summary}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {route.tags.map((t) => (
          <span key={t} className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
            #{t}
          </span>
        ))}
      </div>
      <span className="mt-4 inline-flex text-sm font-medium text-foreground group-hover:gap-1.5">
        Открыть маршрут <span className="ml-1">→</span>
      </span>
    </Link>
  );
}
