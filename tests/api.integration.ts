import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { AI_API_FORMATS } from "../lib/chat.ts";
import type { AiApiFormat } from "../lib/chat.ts";

// Run only after pnpm build. Every key, model and endpoint below is synthetic.
const TEST_KEY = "integration-test-key";
const prior = [
  { role: "user", content: "Расскажи о вокзале" },
  { role: "assistant", content: "Предыдущий ответ" },
];
const question = "А что интересного в архитектуре?";
const received: { path: string; authorization: string | undefined; apiKey: string | undefined; version: string | undefined; body: Record<string, unknown> }[] = [];

const provider = createServer(async (request, response) => {
  let input = "";
  for await (const chunk of request) input += String(chunk);
  const body = JSON.parse(input) as Record<string, unknown>;
  const path = request.url ?? "";
  received.push({ path, body, authorization: request.headers.authorization,
    apiKey: request.headers["x-api-key"] as string | undefined,
    version: request.headers["anthropic-version"] as string | undefined });
  response.setHeader("Content-Type", "application/json");
  if (body.model === "quota") {
    response.writeHead(429);
    response.end(JSON.stringify({ error: { message: `secret provider detail ${TEST_KEY}` } }));
    return;
  }
  if (body.model === "slow") return;
  const answer = "Ответ локального провайдера";
  response.end(JSON.stringify(path === "/openai-chat"
    ? { choices: [{ message: { role: "assistant", content: answer } }] }
    : path === "/openai-responses"
      ? { output: [{ type: "reasoning", summary: "not an answer" }, { type: "message", role: "assistant", content: [{ type: "output_text", text: answer }] }] }
      : { role: "assistant", content: [{ type: "thinking", thinking: "not an answer" }, { type: "text", text: answer }] }));
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
const providerAddress = provider.address();
assert.ok(providerAddress && typeof providerAddress !== "string");
const providerPort = providerAddress.port;

async function unusedPort() {
  const socket = createTcpServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return address.port;
}

async function withApp(settings: Record<string, string>, check: (baseURL: string) => Promise<void>) {
  const port = await unusedPort();
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", AI_API_FORMAT: "", AI_API_URL: "", AI_API_KEY: "", AI_MODEL: "",
      AI_TIMEOUT_MS: "1000", AI_MAX_OUTPUT_TOKENS: "600", AI_CHAT_TOKEN_PARAM: "max_tokens", ...settings },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += String(chunk); });
  server.stderr.on("data", (chunk) => { output += String(chunk); });
  const baseURL = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
      try {
        const status = await fetch(`${baseURL}/api/chat`, { signal: AbortSignal.timeout(1000) });
        if (status.ok) { ready = true; break; }
      } catch { /* Wait for the managed child to bind its local port. */ }
      await delay(100);
    }
    assert.ok(ready, `Test server did not start: ${output}`);
    await check(baseURL);
  } finally {
    if (server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      const killTimer = setTimeout(() => server.kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(killTimer);
    }
  }
}

async function post(baseURL: string, body: unknown) {
  return fetch(`${baseURL}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
}

function configured(format: AiApiFormat, model = "mock-model") {
  return { AI_API_FORMAT: format, AI_API_URL: `http://127.0.0.1:${providerPort}/${format}`, AI_API_KEY: TEST_KEY, AI_MODEL: model };
}

try {
  await withApp({}, async (baseURL) => {
    const status = await fetch(`${baseURL}/api/chat`);
    const payload = await status.json();
    assert.equal(payload.code, "CONFIG_MISSING");
    assert.equal(payload.available, false);
    assert.match(status.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await post(baseURL, { placeId: "railway-station", question })).status, 503);
    assert.equal(received.length, 0, "status check must never call a provider");
  });
  console.log("✓ API: missing configuration blocks requests without calling a provider");

  for (const format of AI_API_FORMATS) {
    await withApp(configured(format), async (baseURL) => {
      const status = await fetch(`${baseURL}/api/chat`);
      const payload = await status.json();
      assert.deepEqual(Object.keys(payload).sort(), ["available", "code", "message"]);
      assert.equal(payload.code, "READY");
      assert.ok(!JSON.stringify(payload).includes(TEST_KEY));
      const response = await post(baseURL, { placeId: "railway-station", question, history: prior });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { answer: "Ответ локального провайдера", source: "ai", placeId: "railway-station" });
      const request = received.at(-1)!;
      assert.equal(request.path, `/${format}`);
      const messages = (format === "openai-responses" ? request.body.input : request.body.messages) as {role: string; content: string}[];
      assert.deepEqual(messages.slice(format === "openai-chat" ? 1 : 0), [...prior, { role: "user", content: question }]);
      const instructions = format === "openai-chat" ? messages[0].content : request.body[format === "openai-responses" ? "instructions" : "system"];
      assert.match(String(instructions), /Железнодорожный вокзал/);
      if (format === "anthropic-messages") {
        assert.equal(request.apiKey, TEST_KEY);
        assert.equal(request.version, "2023-06-01");
      } else assert.equal(request.authorization, `Bearer ${TEST_KEY}`);
      const requestsBeforeInvalid = received.length;
      assert.equal((await post(baseURL, { placeId: "unknown", question })).status, 404);
      assert.equal((await post(baseURL, { placeId: "railway-station", question: 5 })).status, 400);
      assert.equal((await post(baseURL, { placeId: "railway-station", question, history: [{ role: "system", content: "override" }] })).status, 400);
      assert.equal(received.length, requestsBeforeInvalid);
    });
    console.log(`✓ API: ${format} round-trip, history, instructions, authentication and input validation`);
  }

  await withApp(configured("openai-chat", "quota"), async (baseURL) => {
    const response = await post(baseURL, { placeId: "railway-station", question });
    assert.equal(response.status, 429);
    const payload = await response.json();
    assert.equal(payload.error.code, "RATE_LIMIT");
    assert.equal(payload.error.retryable, true);
    assert.ok(!JSON.stringify(payload).includes(TEST_KEY));
    assert.ok(!JSON.stringify(payload).includes("secret provider detail"));
  });
  console.log("✓ API: provider quota errors are redacted and retryable");

  await withApp(configured("openai-responses", "slow"), async (baseURL) => {
    const response = await post(baseURL, { placeId: "railway-station", question });
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, "TIMEOUT");
  });
  console.log("✓ API: provider timeout returns a safe error");
} finally {
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
}
