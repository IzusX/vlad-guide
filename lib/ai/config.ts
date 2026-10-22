// Server-only configuration: never import this module into client components.
import process from "node:process";
import {
  AI_API_FORMATS,
  chatError,
  type AiApiFormat,
  type ChatConfigurationStatus,
} from "../chat.ts";

export type AiConfiguration = {
  format: AiApiFormat;
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  chatTokenParameter: "max_tokens" | "max_completion_tokens";
};

export type AiConfigurationResult =
  | {
      status: ChatConfigurationStatus & { available: true; code: "READY" };
      config: AiConfiguration;
    }
  | {
      status: ChatConfigurationStatus & {
        available: false;
        code: "CONFIG_MISSING" | "CONFIG_INVALID";
      };
      config: null;
    };

type Environment = Readonly<Record<string, string | undefined>>;

function unavailable(code: "CONFIG_MISSING" | "CONFIG_INVALID"): AiConfigurationResult {
  return { status: { available: false, code, message: chatError(code).message }, config: null };
}

function integerSetting(value: string | undefined, fallback: number, min: number, max: number) {
  const text = value?.trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function validEndpoint(value: string): string | null {
  // Require an absolute URL as written, not URL()'s permissive shorthand/backslash forms.
  const authority = /^https?:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (!authority || authority.includes("@") || /[\u0000-\u0020\u007f\\#]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const loopback = hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function readAiConfiguration(env: Environment = process.env): AiConfigurationResult {
  const format = env.AI_API_FORMAT?.trim();
  const endpointText = env.AI_API_URL?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  const model = env.AI_MODEL?.trim();
  if (!format || !endpointText || !apiKey || !model) return unavailable("CONFIG_MISSING");

  const endpoint = validEndpoint(endpointText);
  const timeoutMs = integerSetting(env.AI_TIMEOUT_MS, 30_000, 1_000, 120_000);
  const maxOutputTokens = integerSetting(env.AI_MAX_OUTPUT_TOKENS, 600, 1, 4_096);
  const chatTokenParameter = env.AI_CHAT_TOKEN_PARAM?.trim() || "max_tokens";
  if (
    !AI_API_FORMATS.includes(format as AiApiFormat) || !endpoint || timeoutMs === null ||
    /[\u0000-\u001f\u007f]/.test(apiKey + model) || maxOutputTokens === null ||
    !["max_tokens", "max_completion_tokens"].includes(chatTokenParameter)
  ) return unavailable("CONFIG_INVALID");

  return {
    status: { available: true, code: "READY", message: "ИИ-гид подключён." },
    config: {
      format: format as AiApiFormat,
      endpoint,
      apiKey,
      model,
      timeoutMs,
      maxOutputTokens,
      chatTokenParameter: chatTokenParameter as AiConfiguration["chatTokenParameter"],
    },
  };
}
