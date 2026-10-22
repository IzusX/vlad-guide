import { CHAT_LIMITS, type ChatMessage, type ChatRequest } from "../chat.ts";
import { readBoundedText } from "./body.ts";
import { AiError } from "./errors.ts";

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function text(value: unknown, maxChars: number): string {
  if (typeof value !== "string") throw new AiError("INVALID_REQUEST");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxChars) throw new AiError("INVALID_REQUEST");
  return trimmed;
}

export function parseChatRequest(input: unknown): ChatRequest {
  if (!plainObject(input) || !Object.hasOwn(input, "placeId") || !Object.hasOwn(input, "question")) {
    throw new AiError("INVALID_REQUEST");
  }
  const placeId = text(input.placeId, 128);
  const question = text(input.question, CHAT_LIMITS.questionChars);
  const rawHistory = input.history === undefined ? [] : input.history;
  if (!Array.isArray(rawHistory) || rawHistory.length > CHAT_LIMITS.historyMessages ||
      rawHistory.length > CHAT_LIMITS.historyPairs * 2 || rawHistory.length % 2 !== 0) {
    throw new AiError("INVALID_REQUEST");
  }

  const history: ChatMessage[] = [];
  let totalChars = question.length;
  for (let index = 0; index < rawHistory.length; index++) {
    const message: unknown = rawHistory[index];
    const role = index % 2 === 0 ? "user" : "assistant";
    if (!plainObject(message) || !Object.hasOwn(message, "role") || !Object.hasOwn(message, "content") ||
        message.role !== role) throw new AiError("INVALID_REQUEST");
    const content = text(message.content, role === "user" ? CHAT_LIMITS.questionChars : CHAT_LIMITS.answerChars);
    totalChars += content.length;
    history.push({ role, content });
  }
  const totalLimit = CHAT_LIMITS.questionChars + CHAT_LIMITS.historyPairs *
    (CHAT_LIMITS.questionChars + CHAT_LIMITS.answerChars);
  if (totalChars > totalLimit) throw new AiError("INVALID_REQUEST");
  // Project only contract fields: request-supplied provider settings are never forwarded.
  return { placeId, question, history };
}

export async function readChatRequest(request: Request): Promise<ChatRequest> {
  try {
    const body = await readBoundedText(
      request.body, CHAT_LIMITS.requestBytes, new AiError("INVALID_REQUEST"), request.signal,
      new AiError("INVALID_REQUEST", 413),
    );
    let input: unknown;
    try { input = JSON.parse(body); } catch { throw new AiError("INVALID_REQUEST"); }
    return parseChatRequest(input);
  } catch (error) {
    if (request.signal.aborted) throw new AiError("REQUEST_CANCELLED");
    if (error instanceof AiError) throw error;
    throw new AiError("INVALID_REQUEST");
  }
}
