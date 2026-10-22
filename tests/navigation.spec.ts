import { expect, test } from "@playwright/test";

const routeCases = [
  { id: "historic-1h", title: "Исторический центр за 1 час" },
  { id: "historic-2h", title: "Исторический центр за 2 часа" },
  { id: "views-2h", title: "Виды и море за 2 часа" },
  { id: "views-half-day", title: "Полдня: центр + море" },
];

test("route cards support client navigation without URL-data or Suspense diagnostics", async ({ page }) => {
  const navigationErrors: string[] = [];
  const diagnosticPattern = /URL data|instant-shell-url-data|outside (?:of )?[`<]*Suspense|blocking-prerender/;
  page.on("pageerror", (error) => navigationErrors.push(error.message));
  page.on("console", (message) => {
    if (diagnosticPattern.test(message.text())) navigationErrors.push(message.text());
  });
  await page.route("**/api/chat", (route) => route.fulfill({ json: {
    available: false, code: "CONFIG_MISSING", message: "ИИ-гид не подключён.",
  } }));
  await page.route("https://**.tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("https://unpkg.com/**", (route) => route.abort());

  await page.goto("/");
  // The theme button is disabled in SSR and gets a title after hydration.
  await expect(page.locator('button[title^="Тема:"]')).toBeEnabled();
  await page.evaluate(() => {
    Object.assign(window, { navigationTestSentinel: "client-navigation" });
  });

  for (const routeCase of routeCases) {
    await page.locator(`a[href="/routes/${routeCase.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/routes/${routeCase.id}$`));
    await expect(page.getByRole("heading", { name: routeCase.title, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Чат с ИИ-гидом" }).getByText(/ИИ-гид не подключён/)).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, "navigationTestSentinel"))).toBe("client-navigation");
    await expect(page.locator('nextjs-portal [data-next-badge][data-insights-only="true"]')).toHaveCount(0);
    await expect(page.locator('nextjs-portal [data-next-badge][data-error="true"]')).toHaveCount(0);
    await expect(page.getByText(/Next\.js encountered URL data/)).toHaveCount(0);
    await page.getByRole("link", { name: "← Все маршруты", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Готовые маршруты", exact: true })).toBeVisible();
  }
  expect(navigationErrors).toEqual([]);
});

test("route still supports direct loading and unknown route IDs", async ({ page }) => {
  await page.route("**/api/chat", (route) => route.fulfill({ json: {
    available: false, code: "CONFIG_MISSING", message: "ИИ-гид не подключён.",
  } }));
  await page.route("https://**.tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("https://unpkg.com/**", (route) => route.abort());
  await page.goto("/routes/historic-1h");
  await expect(page.getByRole("heading", { name: "Исторический центр за 1 час", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Исторический центр за 1 час", exact: true })).toBeVisible();
  await page.goto("/routes/unknown-place-for-test");
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
});
