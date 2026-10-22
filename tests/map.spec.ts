import { expect, test } from "@playwright/test";

test("map keeps OSM attribution without Leaflet branding or a flag", async ({ page }) => {
  await page.route("https://**.tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("https://unpkg.com/**", (route) => route.abort());
  await page.goto("/routes/historic-1h");
  const attribution = page.locator(".leaflet-control-attribution");
  await expect(attribution).toHaveCount(1);
  await expect(attribution).toBeVisible();
  await expect(attribution).toHaveText("© OpenStreetMap contributors");
  await expect(attribution.getByRole("link", { name: "OpenStreetMap contributors" }))
    .toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  await expect(page.locator(".leaflet-attribution-flag")).toHaveCount(0);
  await expect(attribution.locator('a[href="https://leafletjs.com"]')).toHaveCount(0);
});
