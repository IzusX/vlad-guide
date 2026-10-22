import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { RouteClient } from "./RouteClient";
import { allRoutes, placesForRoute, getRoute } from "@/lib/data";

export function generateStaticParams() {
  return allRoutes.map((r) => ({ id: r.id }));
}

export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const route = getRoute(id);
  if (!route) return notFound();
  const places = placesForRoute(route);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <Link href="/" className="text-sm text-zinc-600 hover:underline">
          ← Все маршруты
        </Link>
        <div className="mt-4">
          <RouteClient route={route} places={places} />
        </div>
      </main>
    </>
  );
}
