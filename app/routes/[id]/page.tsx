import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { RouteClient } from "./RouteClient";
import { allRoutes, placesForRoute, getRoute } from "@/lib/data";

export function generateStaticParams() {
  return allRoutes.map((r) => ({ id: r.id }));
}

type RoutePageProps = { params: Promise<{ id: string }> };

async function RouteContent({ params }: RoutePageProps) {
  const { id } = await params;
  const route = getRoute(id);
  if (!route) notFound();
  return <RouteClient key={route.id} route={route} places={placesForRoute(route)} />;
}

function RouteLoading() {
  return (
    <div role="status" aria-live="polite" className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
      Загружаем маршрут…
    </div>
  );
}

export default function RoutePage({ params }: RoutePageProps) {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Все маршруты
        </Link>
        <div className="mt-4">
          <Suspense fallback={<RouteLoading />}>
            <RouteContent params={params} />
          </Suspense>
        </div>
      </main>
    </>
  );
}
