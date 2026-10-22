import { chatError, type ChatErrorCode } from "../chat.ts";

const HTTP_STATUSES: Record<ChatErrorCode, number> = {
  CONFIG_MISSING: 503,
  CONFIG_INVALID: 503,
  INVALID_REQUEST: 400,
  PLACE_NOT_FOUND: 404,
  AUTH_ERROR: 502,
  RATE_LIMIT: 429,
  PROVIDER_CONFIG_ERROR: 502,
  TIMEOUT: 504,
  NETWORK_ERROR: 502,
  PROVIDER_UNAVAILABLE: 503,
  INVALID_RESPONSE: 502,
  REFUSED: 422,
  REQUEST_CANCELLED: 499,
};

/** Contains only a public, contract-defined message; never retain provider errors or secrets. */
export class AiError extends Error {
  readonly code: ChatErrorCode;
  readonly httpStatus: number;

  constructor(code: ChatErrorCode, httpStatus: number = HTTP_STATUSES[code]) {
    super(chatError(code).message);
    this.name = "AiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function providerStatusError(status: number): AiError {
  if (status === 401 || status === 403) return new AiError("AUTH_ERROR");
  if (status === 402 || status === 429) return new AiError("RATE_LIMIT");
  if ([400, 404, 405, 422].includes(status)) return new AiError("PROVIDER_CONFIG_ERROR");
  if (status === 408 || status === 504) return new AiError("TIMEOUT");
  if (status >= 500) return new AiError("PROVIDER_UNAVAILABLE");
  return new AiError("INVALID_RESPONSE");
}
