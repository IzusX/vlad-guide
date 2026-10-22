export const CHAT_LIMITS = {
  questionChars: 2_000,
  answerChars: 8_000,
  historyPairs: 5,
  historyMessages: 10,
  requestBytes: 128 * 1024,
} as const;

export const AI_API_FORMATS = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
] as const;

export type AiApiFormat = (typeof AI_API_FORMATS)[number];
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  placeId: string;
  question: string;
  history: ChatMessage[];
};

export type ChatResponse = {
  answer: string;
  source: "ai";
  placeId: string;
};

export const CHAT_ERRORS = {
  CONFIG_MISSING: {
    message: "ИИ-гид не подключён. Настройте провайдера, модель и API-ключ на сервере.",
    retryable: false,
  },
  CONFIG_INVALID: {
    message: "Не удалось включить ИИ-гид. Проверьте настройки провайдера и выбранной модели.",
    retryable: false,
  },
  INVALID_REQUEST: {
    message: "Не удалось отправить сообщение. Проверьте вопрос или очистите диалог.",
    retryable: false,
  },
  PLACE_NOT_FOUND: {
    message: "Это место не найдено. Выберите другую достопримечательность.",
    retryable: false,
  },
  AUTH_ERROR: {
    message: "Не удалось получить доступ к ИИ-гиду. Проверьте настройки подключения.",
    retryable: false,
  },
  RATE_LIMIT: {
    message: "Достигнут лимит запросов или исчерпана квота ИИ-гида. Попробуйте позже.",
    retryable: true,
  },
  PROVIDER_CONFIG_ERROR: {
    message: "Ошибка настройки ИИ-гида. Проверьте провайдера и выбранную модель.",
    retryable: false,
  },
  TIMEOUT: {
    message: "ИИ-гид не успел ответить. Попробуйте ещё раз чуть позже.",
    retryable: true,
  },
  NETWORK_ERROR: {
    message: "Не удалось связаться с ИИ-гидом. Проверьте соединение и попробуйте ещё раз.",
    retryable: true,
  },
  PROVIDER_UNAVAILABLE: {
    message: "ИИ-гид временно недоступен. Попробуйте ещё раз позже.",
    retryable: true,
  },
  INVALID_RESPONSE: {
    message: "Не удалось получить ответ от ИИ-гида. Повторите запрос.",
    retryable: true,
  },
  REFUSED: {
    message: "ИИ-гид не смог ответить на этот вопрос. Попробуйте сформулировать его иначе.",
    retryable: false,
  },
  REQUEST_CANCELLED: {
    message: "Запрос отменён. Можно отправить вопрос ещё раз.",
    retryable: true,
  },
} as const;

export type ChatErrorCode = keyof typeof CHAT_ERRORS;
export type ChatError = {
  code: ChatErrorCode;
  message: string;
  retryable: boolean;
};
export type ChatErrorResponse = { error: ChatError };

export type ChatConfigurationStatus = {
  available: boolean;
  code: "READY" | "CONFIG_MISSING" | "CONFIG_INVALID";
  message: string;
};

export function chatError(code: ChatErrorCode): ChatError {
  return { code, ...CHAT_ERRORS[code] };
}

export function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return typeof value === "string" && Object.hasOwn(CHAT_ERRORS, value);
}
