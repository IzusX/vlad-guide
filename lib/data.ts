import places from "@/data/places.json";
import routes from "@/data/routes.json";
import type { Place, Route } from "./types";

export const allPlaces: Place[] = places as Place[];
export const allRoutes: Route[] = routes as Route[];

export function getPlace(id: string) {
  return allPlaces.find((p) => p.id === id);
}

export function getRoute(id: string) {
  return allRoutes.find((r) => r.id === id);
}

export function placesForRoute(route: Route): Place[] {
  return route.placeIds.map((id) => getPlace(id)!).filter(Boolean);
}
