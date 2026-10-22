import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_API_FORMATS, CHAT_LIMITS, chatError, type ChatErrorCode, type ChatMessage } from "../lib/chat.ts";
import { readAiConfiguration, type AiConfiguration } from "../lib/ai/config.ts";
import { AiError } from "../lib/ai/errors.ts";
import { parseChatRequest, readChatRequest } from "../lib/ai/validation.ts";
import { requestGuideAnswer } from "../lib/ai/provider.ts";

// All configuration and transport values are synthetic; never read .env or call a provider.
const SECRET = "test-only-secret-do-not-expose";
const ENV = {
  AI_API_FORMAT: "openai-chat",
  AI_API_URL: "https://mock.invalid/v1/chat/completions",
  AI_API_KEY: SECRET,
  AI_MODEL: "mock-model",
};
const MESSAGES: ChatMessage[] = [
  { role: "user", content: "Первый вопрос" },
  { role: "assistant", content: "Первый ответ" },
  { role: "user", content: "Уточнение" },
];
const INSTRUCTIONS = "Ответь как локальный гид, не придумывай факты.";
const encoder = new TextEncoder();

function configuration(overrides: Partial<AiConfiguration> = {}): AiConfiguration {
  const result = readAiConfiguration(ENV);
  assert.equal(result.status.code, "READY");
  assert.ok(result.config);
  return { ...result.config, ...overrides };
}

function matchesError(code: ChatErrorCode, httpStatus?: number) {
  return (error: unknown) => {
    assert.ok(error instanceof AiError);
    assert.equal(error.name, "AiError");
    assert.equal(error.code, code);
    assert.equal(error.message, chatError(code).message);
    if (httpStatus !== undefined) assert.equal(error.httpStatus, httpStatus);
    assert.ok(!String(error).includes(SECRET));
    assert.ok(!JSON.stringify(error).includes(SECRET));
    assert.ok(!("cause" in error));
    return true;
  };
}

function responseFetch(payload: unknown, status = 200): typeof fetch {
  return async () => Response.json(payload, { status });
}

function rawFetch(text: string): typeof fetch {
  return async () => new Response(text);
}

function streamedRequest(chunks: Uint8Array[], headers: HeadersInit = {}, onCancel?: () => void): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel() { onCancel?.(); },
  });
  return new Request("https://app.invalid/api/chat", {
    method: "POST", headers, body: stream, duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function ask(payload: unknown, overrides: Partial<AiConfiguration> = {}) {
  return requestGuideAnswer(configuration(overrides), MESSAGES, INSTRUCTIONS, { fetchImpl: responseFetch(payload) });
}

for (const format of AI_API_FORMATS) {
  test(`config: ${format}, defaults, trimming, and public status without secrets`, () => {
    const result = readAiConfiguration({ ...ENV, AI_API_FORMAT: ` ${format} `, AI_API_KEY: ` ${SECRET} `, AI_MODEL: " model " });
    assert.deepEqual(result.status, { available: true, code: "READY", message: "ИИ-гид подключён." });
    assert.deepEqual(result.config, {
      format, endpoint: ENV.AI_API_URL, apiKey: SECRET, model: "model",
      timeoutMs: 30_000, maxOutputTokens: 600, chatTokenParameter: "max_tokens",
    });
    for (const privateValue of [SECRET, ENV.AI_API_URL, "model"]) assert.ok(!JSON.stringify(result.status).includes(privateValue));
  });
}

test("config: every absent/blank required field disables AI", () => {
  for (const field of ["AI_API_FORMAT", "AI_API_URL", "AI_API_KEY", "AI_MODEL"] as const) {
    for (const value of [undefined, "", " \t\n "]) {
      const result = readAiConfiguration({ ...ENV, [field]: value });
      assert.equal(result.config, null);
      assert.deepEqual(result.status, { available: false, code: "CONFIG_MISSING", message: chatError("CONFIG_MISSING").message });
      assert.ok(!JSON.stringify(result).includes(SECRET));
    }
  }
  assert.equal(readAiConfiguration({}).status.code, "CONFIG_MISSING");
});

test("config: HTTPS and HTTP loopback URLs only, no userinfo, fragments, or shorthand", () => {
  for (const url of [
    "https://mock.invalid/custom/full/path?version=1", "http://localhost:8900/mock", "http://localhost.:8900/mock",
    "http://127.0.0.1:8900/mock", "http://127.10.20.30:8900/mock", "http://[::1]:8900/mock",
  ]) assert.equal(readAiConfiguration({ ...ENV, AI_API_URL: url }).status.code, "READY", url);
  for (const url of [
    "", "not-a-url", "mock.invalid/v1", "https:mock.invalid/v1", "//mock.invalid/v1", "ftp://mock.invalid/v1",
    "file:///tmp/mock", "http://mock.invalid/v1", "http://192.168.1.1/v1", "http://0.0.0.0/v1", "http://[::]/v1",
    "http://localhost.evil.invalid/v1", "https://user:password@mock.invalid/v1", "https://@mock.invalid/v1",
    "https://mock.invalid/v1#fragment", "https://mock.invalid/v1#", "https://mock.invalid/a path", "https://mock.invalid/\npath",
    "https:\\mock.invalid\\v1", "https://mock.invalid:99999/v1",
  ]) {
    const result = readAiConfiguration({ ...ENV, AI_API_URL: url });
    assert.equal(result.status.code, url ? "CONFIG_INVALID" : "CONFIG_MISSING", url);
    assert.equal(result.config, null);
    assert.ok(!JSON.stringify(result.status).includes(SECRET));
  }
});

test("config: numeric settings and token parameter are validated, not silently coerced", () => {
  const accepted = readAiConfiguration({ ...ENV, AI_TIMEOUT_MS: " 120000 ", AI_MAX_OUTPUT_TOKENS: "4096", AI_CHAT_TOKEN_PARAM: " max_completion_tokens " });
  assert.equal(accepted.config?.timeoutMs, 120_000);
  assert.equal(accepted.config?.maxOutputTokens, 4_096);
  assert.equal(accepted.config?.chatTokenParameter, "max_completion_tokens");
  assert.equal(readAiConfiguration({ ...ENV, AI_TIMEOUT_MS: "1000", AI_MAX_OUTPUT_TOKENS: "1" }).status.code, "READY");
  for (const [field, values] of [
    ["AI_API_FORMAT", ["openai", "OPENAI-CHAT", SECRET]],
    ["AI_TIMEOUT_MS", ["999", "120001", "-1", "1.5", "1e3", "NaN", "Infinity", "9007199254740993"]],
    ["AI_MAX_OUTPUT_TOKENS", ["0", "4097", "-1", "1.5", "600tokens", "0x258"]],
    ["AI_CHAT_TOKEN_PARAM", ["max_output_tokens", "temperature"]],
    ["AI_API_KEY", [`${SECRET}\r\nX-Injected: yes`]],
    ["AI_MODEL", ["model\u0000"]],
  ] as const) {
    for (const value of values) {
      const result = readAiConfiguration({ ...ENV, [field]: value });
      assert.equal(result.status.code, "CONFIG_INVALID", `${field}=${value}`);
      assert.equal(result.config, null);
      assert.ok(!JSON.stringify(result.status).includes(SECRET));
    }
  }
  const blankOptionals = readAiConfiguration({ ...ENV, AI_TIMEOUT_MS: " ", AI_MAX_OUTPUT_TOKENS: "", AI_CHAT_TOKEN_PARAM: "\t" });
  assert.equal(blankOptionals.config?.timeoutMs, 30_000);
  assert.equal(blankOptionals.config?.maxOutputTokens, 600);
  assert.equal(blankOptionals.config?.chatTokenParameter, "max_tokens");
});

test("AiError exposes contract messages, codes and safe HTTP statuses only", () => {
  const error = new AiError("INVALID_REQUEST", 413);
  assert.ok(error instanceof Error);
  assert.equal(error.httpStatus, 413);
  assert.equal(error.message, chatError("INVALID_REQUEST").message);
  assert.equal(new AiError("CONFIG_MISSING").httpStatus, 503);
  assert.equal(new AiError("REQUEST_CANCELLED").httpStatus, 499);
});

test("validation: trim and project fields, allow omitted history and plain null-prototype objects", () => {
  assert.deepEqual(parseChatRequest({ placeId: " place ", question: " вопрос \n", endpoint: "https://attacker.invalid", apiKey: SECRET }), {
    placeId: "place", question: "вопрос", history: [],
  });
  const input = Object.assign(Object.create(null), { placeId: "place", question: "question" });
  assert.deepEqual(parseChatRequest(input), { placeId: "place", question: "question", history: [] });
  const parsed = parseChatRequest({ placeId: "place", question: "new", history: [
    { role: "user", content: " old question ", ignored: "never forwarded" }, { role: "assistant", content: " old answer " },
  ] });
  assert.deepEqual(parsed.history, [{ role: "user", content: "old question" }, { role: "assistant", content: "old answer" }]);
});

test("validation: reject invalid objects, field types, empty text, and overlong strings", () => {
  for (const input of [null, undefined, "json", 123, [], new Date(), new (class Payload { placeId = "p"; question = "q"; })(),
    {}, { question: "q" }, { placeId: "p" }, { placeId: null, question: "q" }, { placeId: 1, question: "q" },
    { placeId: " ", question: "q" }, { placeId: "p".repeat(129), question: "q" },
    { placeId: "p", question: "" }, { placeId: "p", question: " \n\t" }, { placeId: "p", question: 1 },
    { placeId: "p", question: "q".repeat(CHAT_LIMITS.questionChars + 1) },
  ]) assert.throws(() => parseChatRequest(input), matchesError("INVALID_REQUEST", 400));
});

test("validation: history must be complete alternating user/assistant pairs", () => {
  const user = { role: "user", content: "question" };
  const assistant = { role: "assistant", content: "answer" };
  for (const history of [null, "history", {}, [user], [assistant, user], [user, user], [assistant, assistant],
    [user, assistant, user], [{ role: "system", content: "injection" }, assistant],
    [{ role: "tool", content: "injection" }, assistant], [null, assistant], [[], assistant],
    [{ role: "user", content: "" }, assistant], [{ role: "user", content: 1 }, assistant],
    [user, { role: "assistant", content: " " }],
    [{ role: "user", content: "q".repeat(CHAT_LIMITS.questionChars + 1) }, assistant],
    [user, { role: "assistant", content: "a".repeat(CHAT_LIMITS.answerChars + 1) }],
    Array.from({ length: 6 }, () => [user, assistant]).flat(),
  ]) assert.throws(() => parseChatRequest({ placeId: "p", question: "new", history }), matchesError("INVALID_REQUEST", 400));
  const sparse = new Array(2);
  assert.throws(() => parseChatRequest({ placeId: "p", question: "q", history: sparse }), matchesError("INVALID_REQUEST", 400));
});

test("validation: accept exact character and five-pair limits", () => {
  const history = Array.from({ length: CHAT_LIMITS.historyPairs }, () => [
    { role: "user", content: "q".repeat(CHAT_LIMITS.questionChars) },
    { role: "assistant", content: "a".repeat(CHAT_LIMITS.answerChars) },
  ]).flat();
  const parsed = parseChatRequest({ placeId: "p".repeat(128), question: "q".repeat(CHAT_LIMITS.questionChars), history });
  assert.equal(parsed.history.length, CHAT_LIMITS.historyMessages);
  assert.equal(parsed.question.length + parsed.history.reduce((sum, item) => sum + item.content.length, 0), 52_000);
});

test("readChatRequest: decode streamed UTF-8 across byte boundaries, ignore Content-Length claims", async () => {
  const data = encoder.encode(JSON.stringify({ placeId: "p", question: "Как добраться?" }));
  const chunks = Array.from(data, (byte) => Uint8Array.of(byte));
  const parsed = await readChatRequest(streamedRequest(chunks, { "Content-Length": "99999999" }));
  assert.deepEqual(parsed, { placeId: "p", question: "Как добраться?", history: [] });
  const padded = encoder.encode(JSON.stringify({ placeId: "p", question: "q" }) + " ".repeat(CHAT_LIMITS.requestBytes - encoder.encode(JSON.stringify({ placeId: "p", question: "q" })).length));
  assert.equal((await readChatRequest(streamedRequest([padded], { "Content-Length": "1" }))).question, "q");
});

test("readChatRequest: actual byte cap rejects streamed and buffered bodies with 413", async () => {
  const size = CHAT_LIMITS.requestBytes;
  await assert.rejects(readChatRequest(streamedRequest([encoder.encode(" ".repeat(size)), Uint8Array.of(32)], { "Content-Length": "1" })), matchesError("INVALID_REQUEST", 413));
  // Multi-byte data is counted as bytes, not characters.
  await assert.rejects(readChatRequest(streamedRequest([encoder.encode("я".repeat(size / 2 + 1))])), matchesError("INVALID_REQUEST", 413));
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(size + 1)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://app.invalid/api/chat", { method: "POST", body, duplex: "half" } as RequestInit & { duplex: "half" });
  await assert.rejects(readChatRequest(request), matchesError("INVALID_REQUEST", 413));
  assert.equal(cancelled, true);
});

test("readChatRequest: malformed JSON, invalid UTF-8, empty/consumed/failed bodies are safe 400", async () => {
  for (const value of ["", "{", "null", "[]", JSON.stringify({ placeId: "p", question: "" })]) {
    await assert.rejects(readChatRequest(streamedRequest([encoder.encode(value)])), matchesError("INVALID_REQUEST", 400));
  }
  await assert.rejects(readChatRequest(streamedRequest([Uint8Array.of(0xff)])), matchesError("INVALID_REQUEST", 400));
  await assert.rejects(readChatRequest(new Request("https://app.invalid/api/chat", { method: "POST" })), matchesError("INVALID_REQUEST", 400));
  const used = new Request("https://app.invalid/api/chat", { method: "POST", body: JSON.stringify({ placeId: "p", question: "q" }) });
  await used.text();
  await assert.rejects(readChatRequest(used), matchesError("INVALID_REQUEST", 400));
  const failed = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error(SECRET)); } });
  await assert.rejects(readChatRequest(new Request("https://app.invalid/api/chat", { method: "POST", body: failed, duplex: "half" } as RequestInit & { duplex: "half" })), matchesError("INVALID_REQUEST", 400));
});

test("readChatRequest: cancellation interrupts a body stream and stays redacted", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request("https://app.invalid/api/chat", { method: "POST", body, signal: controller.signal, duplex: "half" } as RequestInit & { duplex: "half" });
  const promise = readChatRequest(request);
  controller.abort(new Error(SECRET));
  await assert.rejects(promise, matchesError("REQUEST_CANCELLED", 499));
  assert.equal(cancelled, true);
});

for (const format of AI_API_FORMATS) {
  test(`provider: ${format} multi-turn payload, headers, endpoint and token limit`, async () => {
    let calls = 0;
    const config = configuration({ format, maxOutputTokens: 777 });
    const fetchImpl: typeof fetch = async (url, init) => {
      calls++;
      assert.equal(url, config.endpoint);
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, false);
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Content-Type"), "application/json");
      assert.equal(headers.get("Accept"), "application/json");
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.model, config.model);
      assert.ok(!("temperature" in payload));
      assert.ok(!JSON.stringify(payload).includes(SECRET));
      if (format === "openai-chat") {
        assert.equal(headers.get("Authorization"), `Bearer ${SECRET}`);
        assert.equal(headers.get("x-api-key"), null);
        assert.deepEqual(payload, { model: config.model, messages: [{ role: "system", content: INSTRUCTIONS }, ...MESSAGES], max_tokens: 777 });
        return Response.json({ choices: [{ message: { role: "assistant", content: " Ответ " } }] });
      }
      if (format === "openai-responses") {
        assert.equal(headers.get("Authorization"), `Bearer ${SECRET}`);
        assert.deepEqual(payload, { model: config.model, instructions: INSTRUCTIONS, input: MESSAGES, max_output_tokens: 777, store: false });
        return Response.json({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: " Ответ " }] }] });
      }
      assert.equal(headers.get("Authorization"), null);
      assert.equal(headers.get("x-api-key"), SECRET);
      assert.equal(headers.get("anthropic-version"), "2023-06-01");
      assert.deepEqual(payload, { model: config.model, system: INSTRUCTIONS, messages: MESSAGES, max_tokens: 777 });
      return Response.json({ type: "message", role: "assistant", content: [{ type: "text", text: " Ответ " }] });
    };
    assert.equal(await requestGuideAnswer(config, MESSAGES, INSTRUCTIONS, { fetchImpl }), "Ответ");
    assert.equal(calls, 1);
  });
}

test("provider: configurable chat token parameter and projected conversation fields", async () => {
  const messages = [{ role: "user" as const, content: "q", endpoint: "https://attacker.invalid", apiKey: SECRET }];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.max_completion_tokens, 600);
    assert.ok(!("max_tokens" in payload));
    assert.deepEqual(payload.messages.slice(1), [{ role: "user", content: "q" }]);
    return Response.json({ choices: [{ message: { content: "ok" } }] });
  };
  assert.equal(await requestGuideAnswer(configuration({ chatTokenParameter: "max_completion_tokens" }), messages, INSTRUCTIONS, { fetchImpl }), "ok");
});

test("provider: chat text arrays ignore reasoning, tools, images and other choices", async () => {
  assert.equal(await ask({ choices: [
    { message: { role: "assistant", reasoning_content: "secret reasoning", content: [
      { type: "reasoning", text: "ignore" }, { type: "text", text: " Один " }, { type: "image_url", text: "ignore" },
      { type: "tool_call", text: "ignore" }, { type: "text", text: " " }, { type: "text", text: "Два" },
    ] } }, { message: { content: "ignore other choice" } },
  ] }), "Один\nДва");
});

test("provider: Responses reads assistant output_text blocks only, never SDK top-level convenience", async () => {
  assert.equal(await ask({ output_text: "ignore convenience", output: [
    { type: "reasoning", content: [{ type: "output_text", text: "ignore" }] },
    { type: "function_call", text: "ignore" },
    { type: "message", role: "user", content: [{ type: "output_text", text: "ignore" }] },
    { type: "message", role: "assistant", content: [
      { type: "reasoning", text: "ignore" }, { type: "output_text", text: " Один " }, { type: "text", text: "ignore" },
    ] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Два" }] },
  ] }, { format: "openai-responses" }), "Один\nДва");
  await assert.rejects(ask({ output_text: "not wire protocol text" }, { format: "openai-responses" }), matchesError("INVALID_RESPONSE", 502));
});

test("provider: Anthropic reads text only and ignores thinking, tools and images", async () => {
  assert.equal(await ask({ type: "message", role: "assistant", content: [
    { type: "thinking", thinking: "ignore", text: "ignore" }, { type: "text", text: " Один " },
    { type: "tool_use", name: "ignore", text: "ignore" }, { type: "image", text: "ignore" }, { type: "text", text: "Два" },
  ] }, { format: "anthropic-messages" }), "Один\nДва");
});

test("provider: refuses empty or unexpected JSON instead of serializing it", async () => {
  for (const payload of [null, [], "hello", 123, {}, { answer: "wrong schema" }, { choices: [] },
    { choices: [{ message: { content: " " } }] }, { choices: [{ message: { role: "user", content: "not assistant" } }] },
    { choices: [{ message: { content: [{ type: "reasoning", text: "hidden" }] } }] },
    { choices: [{ message: { content: { text: "not a string or array" } } }] },
  ]) await assert.rejects(ask(payload), matchesError("INVALID_RESPONSE", 502));
  for (const payload of [{ output: [] }, { output: [{ type: "message", role: "user", content: [{ type: "output_text", text: "ignore" }] }] },
    { output: [{ type: "message", content: [{ type: "output_text", text: "no assistant role" }] }] },
    { status: "failed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ignore failed" }] }] },
  ]) await assert.rejects(ask(payload, { format: "openai-responses" }), matchesError("INVALID_RESPONSE", 502));
  for (const payload of [{ content: [] }, { content: [{ type: "thinking", text: "hidden" }] },
    { role: "user", content: [{ type: "text", text: "ignore" }] },
  ]) await assert.rejects(ask(payload, { format: "anthropic-messages" }), matchesError("INVALID_RESPONSE", 502));
});

test("provider: model refusal is explicit across all protocols", async () => {
  for (const payload of [
    { choices: [{ message: { content: null, refusal: SECRET } }] },
    { choices: [{ finish_reason: "content_filter", message: { content: "partial" } }] },
    { choices: [{ message: { content: [{ type: "refusal", refusal: SECRET }] } }] },
  ]) await assert.rejects(ask(payload), matchesError("REFUSED", 422));
  await assert.rejects(ask({ output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: SECRET }] }] }, { format: "openai-responses" }), matchesError("REFUSED", 422));
  await assert.rejects(ask({ incomplete_details: { reason: "content_filter" }, output: [] }, { format: "openai-responses" }), matchesError("REFUSED", 422));
  await assert.rejects(ask({ stop_reason: "refusal", content: [{ type: "text", text: SECRET }] }, { format: "anthropic-messages" }), matchesError("REFUSED", 422));
});

test("provider: error envelopes in 2xx responses take precedence, redact provider detail", async () => {
  const cases: Array<[unknown, ChatErrorCode]> = [
    [{ type: "authentication_error", message: SECRET }, "AUTH_ERROR"],
    [{ code: "invalid_api_key", message: SECRET }, "AUTH_ERROR"],
    [{ type: "invalid_request_error", code: "invalid_api_key", message: SECRET }, "AUTH_ERROR"],
    [{ type: "invalid_request_error", code: "insufficient_quota", message: SECRET }, "RATE_LIMIT"],
    [{ type: "invalid_request_error", code: "content_policy_violation", message: SECRET }, "REFUSED"],
    [{ type: "permission_error", message: SECRET }, "AUTH_ERROR"],
    [{ code: "insufficient_quota", message: SECRET }, "RATE_LIMIT"],
    [{ type: "rate_limit_error", message: SECRET }, "RATE_LIMIT"],
    [{ type: "invalid_request_error", message: SECRET }, "PROVIDER_CONFIG_ERROR"],
    [{ code: "model_not_found", message: SECRET }, "PROVIDER_CONFIG_ERROR"],
    [{ type: "timeout_error", message: SECRET }, "TIMEOUT"],
    [{ type: "overloaded_error", message: SECRET }, "PROVIDER_UNAVAILABLE"],
    [{ code: "content_policy_violation", message: SECRET }, "REFUSED"],
    [{ status: 401, message: SECRET }, "AUTH_ERROR"],
    [{ status_code: "429", message: SECRET }, "RATE_LIMIT"],
    [{ code: "503", message: SECRET }, "PROVIDER_UNAVAILABLE"],
    [{ message: SECRET }, "INVALID_RESPONSE"], [SECRET, "INVALID_RESPONSE"], [false, "INVALID_RESPONSE"],
  ];
  for (const [error, code] of cases) {
    for (const format of AI_API_FORMATS) await assert.rejects(ask({ error, choices: [{ message: { content: "should not return" } }] }, { format }), matchesError(code));
  }
  await assert.rejects(ask({ type: "error", error: { type: "authentication_error", message: SECRET } }, { format: "anthropic-messages" }), matchesError("AUTH_ERROR"));
});

for (const [status, code, httpStatus] of [
  [400, "PROVIDER_CONFIG_ERROR", 502], [401, "AUTH_ERROR", 502], [403, "AUTH_ERROR", 502],
  [402, "RATE_LIMIT", 429], [404, "PROVIDER_CONFIG_ERROR", 502], [405, "PROVIDER_CONFIG_ERROR", 502],
  [422, "PROVIDER_CONFIG_ERROR", 502], [429, "RATE_LIMIT", 429], [408, "TIMEOUT", 504], [504, "TIMEOUT", 504],
  [500, "PROVIDER_UNAVAILABLE", 503], [503, "PROVIDER_UNAVAILABLE", 503], [529, "PROVIDER_UNAVAILABLE", 503],
  [302, "INVALID_RESPONSE", 502], [418, "INVALID_RESPONSE", 502],
] as const) {
  test(`provider: HTTP ${status} maps to ${code}, no retries or raw error leakage`, async () => {
    let calls = 0;
    let cancelled = false;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(encoder.encode(SECRET)); },
        cancel() { cancelled = true; },
      }), { status });
    };
    await assert.rejects(requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl }), matchesError(code, httpStatus));
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
  });
}

test("provider: malformed/non-JSON/invalid UTF-8/empty responses are redacted", async () => {
  for (const text of ["", "{", `<html>${SECRET}</html>`, SECRET]) {
    await assert.rejects(requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl: rawFetch(text) }), matchesError("INVALID_RESPONSE", 502));
  }
  await assert.rejects(requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl: async () => new Response(Uint8Array.of(0xff)) }), matchesError("INVALID_RESPONSE", 502));
  await assert.rejects(requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl: async () => new Response(null, { status: 204 }) }), matchesError("INVALID_RESPONSE", 502));
});

test("provider: cap upstream streamed bytes at 256KB and cancel unread body", async () => {
  let cancelled = false;
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(256 * 1024));
      controller.enqueue(Uint8Array.of(32));
    },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Length": "1" } });
  await assert.rejects(requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl }), matchesError("INVALID_RESPONSE", 502));
  assert.equal(cancelled, true);
  const wire = JSON.stringify({ choices: [{ message: { content: "ok" } }] });
  const exact = wire + " ".repeat(256 * 1024 - encoder.encode(wire).length);
  assert.equal(await requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl: rawFetch(exact) }), "ok");
});

test("provider: truncate every protocol at answerChars, without broken surrogate pairs", async () => {
  const text = "a".repeat(CHAT_LIMITS.answerChars + 100);
  for (const format of AI_API_FORMATS) {
    const payload = format === "openai-chat" ? { choices: [{ message: { content: text } }] } :
      format === "openai-responses" ? { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] } :
      { content: [{ type: "text", text }] };
    assert.equal((await ask(payload, { format })).length, CHAT_LIMITS.answerChars);
  }
  const unicode = "a".repeat(CHAT_LIMITS.answerChars - 1) + "😀more";
  const answer = await ask({ choices: [{ message: { content: unicode } }] });
  assert.equal(answer.length, CHAT_LIMITS.answerChars - 1);
  assert.ok(!/[\uD800-\uDBFF]$/.test(answer));
});

test("provider: network failures and body transport failures do not leak exceptions", async () => {
  const fetchImpl: typeof fetch = async () => { throw new Error(`socket failed: ${SECRET}`); };
  await assert.rejects(requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl }), matchesError("NETWORK_ERROR", 502));
  const bodyFailure: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.error(new Error(SECRET)); },
  }));
  await assert.rejects(requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl: bodyFailure }), matchesError("NETWORK_ERROR", 502));
  const redirectFailure: typeof fetch = async (_url, init) => {
    assert.equal(init?.redirect, "error");
    throw new TypeError(`redirect failed ${SECRET}`);
  };
  await assert.rejects(requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl: redirectFailure }), matchesError("NETWORK_ERROR", 502));
});

test("provider: timeout aborts fetch, including transports that ignore AbortSignal", async () => {
  let signal: AbortSignal | null | undefined;
  const fetchImpl: typeof fetch = (_url, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  };
  await assert.rejects(requestGuideAnswer(configuration({ timeoutMs: 15 }), MESSAGES, INSTRUCTIONS, { fetchImpl }), matchesError("TIMEOUT", 504));
  assert.equal(signal?.aborted, true);
});

test("provider: deadline includes body reading and cancels a stalled stream", async () => {
  let cancelled = false;
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode('{"choices":')); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(requestGuideAnswer(configuration({ timeoutMs: 15 }), MESSAGES, INSTRUCTIONS, { fetchImpl }), matchesError("TIMEOUT", 504));
  assert.equal(cancelled, true);
});

test("provider: pre-cancelled request never starts fetch", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort(SECRET);
  const fetchImpl: typeof fetch = async () => { calls++; return Response.json({}); };
  await assert.rejects(requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl, signal: controller.signal }), matchesError("REQUEST_CANCELLED", 499));
  assert.equal(calls, 0);
});

test("provider: client cancellation aborts in-flight fetch, not NETWORK_ERROR or TIMEOUT", async () => {
  const controller = new AbortController();
  let transportSignal: AbortSignal | null | undefined;
  const fetchImpl: typeof fetch = (_url, init) => {
    transportSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error(SECRET)), { once: true });
    });
  };
  const promise = requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl, signal: controller.signal });
  controller.abort(new Error(SECRET));
  await assert.rejects(promise, matchesError("REQUEST_CANCELLED", 499));
  assert.equal(transportSignal?.aborted, true);
});

test("provider: cancellation during body reading cancels stream and clears timer", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  let cancelled = false;
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    pull() { started(); },
    cancel() { cancelled = true; },
  }));
  const promise = requestGuideAnswer(configuration({ timeoutMs: 100 }), MESSAGES, INSTRUCTIONS, { fetchImpl, signal: controller.signal });
  await reading;
  controller.abort(SECRET);
  await assert.rejects(promise, matchesError("REQUEST_CANCELLED", 499));
  assert.equal(cancelled, true);
});

test("provider: late response after cancellation is discarded without retry", async () => {
  const controller = new AbortController();
  let release!: (response: Response) => void;
  const fetchImpl: typeof fetch = () => new Promise<Response>((resolve) => { release = resolve; });
  const promise = requestGuideAnswer(configuration(), MESSAGES, INSTRUCTIONS, { fetchImpl, signal: controller.signal });
  controller.abort(SECRET);
  await assert.rejects(promise, matchesError("REQUEST_CANCELLED", 499));
  let cancelled = false;
  release(new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } })));
  await Promise.resolve();
  assert.equal(cancelled, true);
});
