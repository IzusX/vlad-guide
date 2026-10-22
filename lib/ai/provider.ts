// Server-only adapter. The endpoint/key come exclusively from validated server configuration.
import { CHAT_LIMITS, type AiApiFormat, type ChatMessage } from "../chat.ts";
import { type AiConfiguration } from "./config.ts";
import { readBoundedText } from "./body.ts";
import { AiError, providerStatusError } from "./errors.ts";

const RESPONSE_BYTES = 256 * 1024;
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function providerError(error: unknown): AiError {
  const detail = object(error);
  for (const value of [detail?.status, detail?.status_code, detail?.http_status, detail?.code]) {
    const status = typeof value === "number" ? value : typeof value === "string" && /^[45]\d{2}$/.test(value) ? Number(value) : 0;
    if (Number.isInteger(status) && status >= 400 && status <= 599) return providerStatusError(status);
  }
  // A concrete code is more specific than broad types such as invalid_request_error.
  const kinds = [detail?.code, detail?.type, typeof error === "string" ? error : undefined];
  for (const kind of kinds) {
    if (typeof kind !== "string") continue;
    const code = kind.toLowerCase();
    if (["authentication_error", "permission_error", "invalid_api_key", "unauthorized", "forbidden"].includes(code)) return new AiError("AUTH_ERROR");
    if (["rate_limit_error", "rate_limit_exceeded", "insufficient_quota", "billing_error", "billing_hard_limit_reached"].includes(code)) return new AiError("RATE_LIMIT");
    if (["invalid_request_error", "invalid_request", "not_found_error", "model_not_found", "unsupported_model", "invalid_model"].includes(code)) return new AiError("PROVIDER_CONFIG_ERROR");
    if (["timeout", "timeout_error", "request_timeout"].includes(code)) return new AiError("TIMEOUT");
    if (["api_error", "server_error", "overloaded_error", "service_unavailable"].includes(code)) return new AiError("PROVIDER_UNAVAILABLE");
    if (["refusal", "content_filter", "content_policy_violation", "safety"].includes(code)) return new AiError("REFUSED");
  }
  return new AiError("INVALID_RESPONSE");
}

function refusal(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function textBlocks(value: unknown, kind: "text" | "output_text"): string[] {
  if (!Array.isArray(value)) return [];
  const texts: string[] = [];
  for (const item of value) {
    const block = object(item);
    if (block?.type === "refusal" || refusal(block?.refusal)) throw new AiError("REFUSED");
    if (block?.type === kind && typeof block.text === "string" && block.text.trim()) texts.push(block.text.trim());
  }
  return texts;
}

function extractAnswer(payload: unknown, format: AiApiFormat): string {
  const root = object(payload);
  if (!root) throw new AiError("INVALID_RESPONSE");
  if (root.error !== undefined && root.error !== null) throw providerError(root.error);
  if (root.type === "error") throw providerError(root);
  if (refusal(root.refusal) || root.stop_reason === "refusal" || root.stop_reason === "content_filter" ||
      object(root.incomplete_details)?.reason === "content_filter") throw new AiError("REFUSED");

  let texts: string[] = [];
  if (format === "openai-chat") {
    const choice = object(Array.isArray(root.choices) ? root.choices[0] : null);
    const message = object(choice?.message);
    if (refusal(message?.refusal) || choice?.finish_reason === "content_filter" || choice?.finish_reason === "refusal") {
      throw new AiError("REFUSED");
    }
    if (message && (message.role === undefined || message.role === "assistant")) {
      texts = typeof message.content === "string" ? [message.content] : textBlocks(message.content, "text");
    }
  } else if (format === "openai-responses") {
    if (root.status === "failed" || root.status === "cancelled") throw new AiError("INVALID_RESPONSE");
    for (const item of Array.isArray(root.output) ? root.output : []) {
      const message = object(item);
      if (message?.type === "message" && message.role === "assistant") {
        texts.push(...textBlocks(message.content, "output_text"));
      }
    }
  } else {
    if (root.role === undefined || root.role === "assistant") texts = textBlocks(root.content, "text");
  }

  const answer = texts.join("\n").trim();
  if (!answer) throw new AiError("INVALID_RESPONSE");
  let bounded = answer.slice(0, CHAT_LIMITS.answerChars);
  // Do not cut a UTF-16 surrogate pair in half at the UI's character limit.
  if (/[\uD800-\uDBFF]$/.test(bounded)) bounded = bounded.slice(0, -1);
  return bounded.trimEnd();
}

function requestPayload(config: AiConfiguration, messages: ChatMessage[], instructions: string) {
  const conversation = messages.map(({ role, content }) => ({ role, content }));
  if (config.format === "openai-chat") {
    return {
      model: config.model,
      messages: [{ role: "system", content: instructions }, ...conversation],
      [config.chatTokenParameter]: config.maxOutputTokens,
    };
  }
  if (config.format === "openai-responses") {
    return { model: config.model, instructions, input: conversation, max_output_tokens: config.maxOutputTokens, store: false };
  }
  return { model: config.model, system: instructions, messages: conversation, max_tokens: config.maxOutputTokens };
}

function discard(response: Response) {
  if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
}

export async function requestGuideAnswer(
  config: AiConfiguration,
  messages: ChatMessage[],
  instructions: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<string> {
  if (options.signal?.aborted) throw new AiError("REQUEST_CANCELLED");
  const controller = new AbortController();
  let aborted: AiError | undefined;
  let rejectAbort!: (error: AiError) => void;
  const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = (error: AiError) => {
    if (aborted) return;
    aborted = error;
    controller.abort();
    rejectAbort(error);
  };
  const onCancel = () => abort(new AiError("REQUEST_CANCELLED"));
  options.signal?.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(() => abort(new AiError("TIMEOUT")), config.timeoutMs);

  const operation = async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (config.format === "anthropic-messages") {
      headers["x-api-key"] = config.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
    const response = await (options.fetchImpl ?? fetch)(config.endpoint, {
      method: "POST", headers, body: JSON.stringify(requestPayload(config, messages, instructions)),
      redirect: "error", signal: controller.signal,
    });
    // A fetch implementation may ignore abort; still discard any late response.
    if (controller.signal.aborted) { discard(response); throw aborted; }
    if (!response.ok) { discard(response); throw providerStatusError(response.status); }
    const text = await readBoundedText(response.body, RESPONSE_BYTES, new AiError("INVALID_RESPONSE"), controller.signal);
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { throw new AiError("INVALID_RESPONSE"); }
    return extractAnswer(payload, config.format);
  };

  try {
    // The race also bounds injected transports that do not implement AbortSignal.
    return await Promise.race([operation(), abortPromise]);
  } catch (error) {
    if (aborted) throw aborted;
    if (error instanceof AiError) throw error;
    throw new AiError("NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCancel);
  }
}
