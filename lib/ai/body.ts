import { AiError } from "./errors.ts";

/** Count real streamed bytes before decoding; cancel unread data on failure or abort. */
export async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  invalid: AiError,
  signal?: AbortSignal,
  tooLarge: AiError = invalid,
): Promise<string> {
  if (!body || body.locked) throw invalid;
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  let finished = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new AiError("REQUEST_CANCELLED");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new AiError("REQUEST_CANCELLED");
      if (done) { finished = true; break; }
      if (!(value instanceof Uint8Array)) throw invalid;
      if ((bytes += value.byteLength) > maxBytes) throw tooLarge;
      if (value.byteLength === 0) continue;
      try { chunks.push(decoder.decode(value, { stream: true })); } catch { throw invalid; }
    }
    try { chunks.push(decoder.decode()); } catch { throw invalid; }
    return chunks.join("");
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!finished) cancel();
    reader.releaseLock();
  }
}
