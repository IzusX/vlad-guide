import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const ready = { available: true, code: "READY", message: "ИИ-гид подключён." };

test.beforeEach(async ({ page }) => {
  // These tests focus on the chat and do not depend on external map/CDN access.
  await page.route("https://**.tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("https://unpkg.com/**", (route) => route.abort());
});

async function openChat(page: Page) {
  await page.goto("/routes/historic-1h");
  return page.getByRole("region", { name: "Чат с ИИ-гидом" });
}

test("missing configuration blocks input, submit and suggested questions", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: {
      available: false, code: "CONFIG_MISSING",
      message: "ИИ-гид не подключён. Настройте провайдера, модель и API-ключ на сервере.",
    } });
  });
  const chat = await openChat(page);
  await expect(chat.getByText(/ИИ-гид не подключён/)).toBeVisible();
  await expect(chat.getByRole("textbox")).toBeDisabled();
  await expect(chat.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled();
  await expect(chat.getByRole("button", { name: "Почему это место важно для Владивостока?", exact: true })).toBeDisabled();
});

test("configuration retry enables the chat without reloading", async ({ page }) => {
  let configured = false;
  await page.route("**/api/chat", (route) => route.fulfill({ json: configured ? ready : {
    available: false, code: "CONFIG_INVALID", message: "Неверная конфигурация",
  } }));
  const chat = await openChat(page);
  await expect(chat.getByRole("textbox")).toBeDisabled();
  configured = true;
  await chat.getByRole("button", { name: "Проверить подключение", exact: true }).click();
  await expect(chat.getByRole("textbox")).toBeEnabled();
});

test("history is sent with follow-ups and is isolated by place", async ({ page }) => {
  const requests: { placeId: string; question: string; history: { role: string; content: string }[] }[] = [];
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ready });
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({ json: { answer: `Ответ ${requests.length}`, source: "ai", placeId: body.placeId } });
  });
  const chat = await openChat(page);
  const textbox = chat.getByRole("textbox");
  await expect(textbox).toBeEnabled();
  await textbox.fill("Когда построили?");
  await textbox.press("Enter");
  await expect(chat.getByText("Ответ 1", { exact: true })).toBeVisible();
  await textbox.fill("А кто архитектор?");
  await textbox.press("Enter");
  await expect(chat.getByText("Ответ 2", { exact: true })).toBeVisible();
  expect(requests[1].history).toEqual([
    { role: "user", content: "Когда построили?" }, { role: "assistant", content: "Ответ 1" },
  ]);

  await page.getByRole("button", { name: "Спросить ИИ-гида", exact: true }).nth(1).click();
  await textbox.fill("Чем интересна площадь?");
  await textbox.press("Enter");
  await expect(chat.getByText("Ответ 3", { exact: true })).toBeVisible();
  expect(requests[2].placeId).toBe("central-square");
  expect(requests[2].history).toEqual([]);
  await page.getByRole("button", { name: "Спросить ИИ-гида", exact: true }).first().click();
  await expect(chat.getByText("Ответ 2", { exact: true })).toBeVisible();
  await expect(chat.getByText("Ответ 3", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(chat.getByRole("textbox")).toBeEnabled();
  await expect(chat.getByText("Ответ 1", { exact: true })).toHaveCount(0);
});

test("quota errors are normalized and retry does not duplicate the question", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ready });
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 429, json: {
      error: { code: "RATE_LIMIT", message: "INTERNAL_PROVIDER_ERROR secret-key", retryable: true },
    } });
    const { placeId } = route.request().postDataJSON();
    return route.fulfill({ json: { answer: "Успешный повтор", source: "ai", placeId } });
  });
  const chat = await openChat(page);
  await expect(chat.getByRole("textbox")).toBeEnabled();
  await chat.getByRole("textbox").fill("История вокзала");
  await chat.getByRole("textbox").press("Enter");
  await expect(chat.getByRole("alert")).toContainText("Достигнут лимит");
  await expect(chat.getByText(/secret-key/)).toHaveCount(0);
  await chat.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(chat.getByText("Успешный повтор", { exact: true })).toBeVisible();
  await expect(chat.getByText("История вокзала", { exact: true })).toHaveCount(1);
  expect(attempts).toBe(2);
});

test("duplicate sends are blocked and late answer follows the original place", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ready });
    requests += 1;
    const { placeId } = route.request().postDataJSON();
    await gate;
    await route.fulfill({ json: { answer: "Ответ про вокзал", source: "ai", placeId } });
  });
  const chat = await openChat(page);
  await expect(chat.getByRole("textbox")).toBeEnabled();
  await chat.getByRole("textbox").fill("Расскажи историю");
  await chat.getByRole("textbox").press("Enter");
  await expect(chat.getByRole("textbox")).toBeDisabled();
  await expect(chat.getByRole("button", { name: "Отправляем…" })).toBeDisabled();
  await page.getByRole("button", { name: "Спросить ИИ-гида", exact: true }).nth(1).click();
  await expect(chat.getByText(/Гид отвечает на вопрос о другом месте/)).toBeVisible();
  release();
  await expect(chat.getByRole("textbox")).toBeEnabled();
  await expect(chat.getByText("Ответ про вокзал", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Спросить ИИ-гида", exact: true }).first().click();
  await expect(chat.getByText("Ответ про вокзал", { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test("clear removes messages and cancels the in-flight request", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ready });
    const { placeId } = route.request().postDataJSON();
    await gate;
    await route.fulfill({ json: { answer: "Опоздавший ответ", source: "ai", placeId } }).catch(() => {});
  });
  const chat = await openChat(page);
  await expect(chat.getByRole("textbox")).toBeEnabled();
  await chat.getByRole("textbox").fill("Мой вопрос");
  await chat.getByRole("textbox").press("Enter");
  await expect(chat.getByText("Гид готовит ответ…", { exact: true })).toBeVisible();
  await chat.getByRole("button", { name: "Очистить диалог", exact: true }).click();
  release();
  await expect(chat.getByRole("textbox")).toBeEnabled();
  await expect(chat.getByText("Мой вопрос", { exact: true })).toHaveCount(0);
  await expect(chat.getByText("Опоздавший ответ", { exact: true })).toHaveCount(0);
});

test("unknown provider failure and invalid JSON never surface raw payloads", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ready });
    attempts += 1;
    return route.fulfill(attempts === 1
      ? { status: 502, body: "<html>Provider broke: secret-key</html>", contentType: "text/html" }
      : { json: { answer: "", source: "ai", placeId: "railway-station" } });
  });
  const chat = await openChat(page);
  await expect(chat.getByRole("textbox")).toBeEnabled();
  await chat.getByRole("textbox").fill("История");
  await chat.getByRole("textbox").press("Enter");
  await expect(chat.getByRole("alert")).toContainText("ИИ-гид временно недоступен");
  await expect(chat.getByText(/secret-key/)).toHaveCount(0);
  await chat.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(chat.getByRole("alert")).toContainText("Не удалось получить ответ");
});

test("chat fits the viewport and renders unsafe answer text without HTML execution", async ({ page }) => {
  const answer = `<script>window.chatUnsafe = true</script>\n${"ОченьДлинныйОтвет".repeat(50)}`;
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ready });
    const { placeId } = route.request().postDataJSON();
    await route.fulfill({ json: { answer, source: "ai", placeId } });
  });
  const chat = await openChat(page);
  await expect(chat.getByRole("textbox")).toBeEnabled();
  await chat.getByRole("textbox").fill("Тест");
  await chat.getByRole("textbox").press("Shift+Enter");
  expect(await chat.getByRole("textbox").inputValue()).toContain("\n");
  await chat.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(chat.getByText(answer, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.hasOwn(window, "chatUnsafe"))).toBe(false);
  expect(await chat.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const bounds = await chat.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
