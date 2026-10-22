"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { CHAT_LIMITS, chatError, isChatErrorCode } from "@/lib/chat";
import type { ChatError } from "@/lib/chat";
import { INITIAL_CHAT_STATE, chatReducer, conversationFor, historyFor } from "@/lib/chat-state";
import type { Place } from "@/lib/types";

type ConnectionState =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "blocked"; error: ChatError }
  | { kind: "error"; error: ChatError };

type InFlightRequest = { id: string; placeId: string; controller: AbortController };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseError(payload: unknown, status: number): ChatError {
  if (isObject(payload) && isObject(payload.error) && isChatErrorCode(payload.error.code)) {
    return chatError(payload.error.code);
  }
  if (status === 429 || status === 402) return chatError("RATE_LIMIT");
  if (status === 401 || status === 403) return chatError("AUTH_ERROR");
  if (status === 400 || status === 413) return chatError("INVALID_REQUEST");
  if (status === 404) return chatError("PLACE_NOT_FOUND");
  return chatError("PROVIDER_UNAVAILABLE");
}

async function readConnection(signal: AbortSignal): Promise<ConnectionState> {
  try {
    const response = await fetch("/api/chat", { cache: "no-store", signal });
    const payload: unknown = await response.json();
    if (!response.ok) return { kind: "error", error: responseError(payload, response.status) };
    if (isObject(payload) && payload.available === true && payload.code === "READY") return { kind: "ready" };
    if (isObject(payload) && payload.available === false
      && (payload.code === "CONFIG_MISSING" || payload.code === "CONFIG_INVALID")) {
      return { kind: "blocked", error: chatError(payload.code) };
    }
    return { kind: "error", error: chatError("INVALID_RESPONSE") };
  } catch {
    return { kind: "error", error: chatError(signal.aborted ? "TIMEOUT" : "NETWORK_ERROR") };
  }
}

export function Chat({ place }: { place: Place | null }) {
  const [connection, setConnection] = useState<ConnectionState>({ kind: "checking" });
  const [state, dispatch] = useReducer(chatReducer, INITIAL_CHAT_STATE);
  const requestRef = useRef<InFlightRequest | null>(null);
  const messageCounterRef = useRef(0);
  const configurationRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const conversation = conversationFor(state, place?.id ?? "");

  function checkConnection() {
    configurationRef.current?.abort();
    const controller = new AbortController();
    configurationRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    void readConnection(controller.signal).then((result) => {
      if (configurationRef.current === controller) setConnection(result);
    }).finally(() => {
      window.clearTimeout(timer);
      if (configurationRef.current === controller) configurationRef.current = null;
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    configurationRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    void readConnection(controller.signal).then((result) => {
      if (configurationRef.current === controller) setConnection(result);
    }).finally(() => {
      window.clearTimeout(timer);
      if (configurationRef.current === controller) configurationRef.current = null;
    });
    return () => {
      window.clearTimeout(timer);
      configurationRef.current?.abort();
      configurationRef.current = null;
      requestRef.current?.controller.abort();
      requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [place?.id, conversation.messages.length, state.pending]);

  async function send(prompt?: string, retryId?: string) {
    if (!place || connection.kind !== "ready" || requestRef.current) return;
    const selectedPlaceId = place.id;
    const failedMessage = retryId
      ? conversation.messages.find((message) => message.id === retryId && message.status === "failed")
      : undefined;
    if (retryId && (!failedMessage || !failedMessage.error?.retryable)) return;
    const question = (failedMessage?.content ?? prompt ?? conversation.draft).trim();
    if (!question || question.length > CHAT_LIMITS.questionChars) return;
    const messageId = retryId ?? `message-${++messageCounterRef.current}`;
    const controller = new AbortController();
    const pending: InFlightRequest = { id: messageId, placeId: selectedPlaceId, controller };
    requestRef.current = pending;
    dispatch({ type: "start", placeId: selectedPlaceId, messageId, question });
    let timedOut = false;
    // The server timeout is configurable up to 120 seconds.
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 130_000);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: selectedPlaceId, question, history: historyFor(conversation, retryId) }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (requestRef.current !== pending) return;
      if (!response.ok) {
        const error = responseError(payload, response.status);
        dispatch({ type: "failure", placeId: selectedPlaceId, messageId, error });
        if (error.code === "CONFIG_MISSING" || error.code === "CONFIG_INVALID") {
          setConnection({ kind: "blocked", error });
        }
      } else if (isObject(payload) && payload.source === "ai" && payload.placeId === selectedPlaceId
        && typeof payload.answer === "string" && payload.answer.trim()
        && payload.answer.length <= CHAT_LIMITS.answerChars) {
        dispatch({ type: "success", placeId: selectedPlaceId, messageId, answer: payload.answer.trim() });
      } else {
        dispatch({ type: "failure", placeId: selectedPlaceId, messageId, error: chatError("INVALID_RESPONSE") });
      }
    } catch {
      if (requestRef.current === pending) {
        dispatch({
          type: "failure", placeId: selectedPlaceId, messageId,
          error: chatError(timedOut ? "TIMEOUT" : "NETWORK_ERROR"),
        });
      }
    } finally {
      window.clearTimeout(timer);
      if (requestRef.current === pending) requestRef.current = null;
    }
  }

  function clearConversation() {
    if (!place) return;
    if (requestRef.current?.placeId === place.id) {
      requestRef.current.controller.abort();
      requestRef.current = null;
    }
    dispatch({ type: "clear", placeId: place.id });
  }

  function refreshConnection() {
    if (requestRef.current) return;
    setConnection({ kind: "checking" });
    void checkConnection();
  }

  if (!place) {
    return (
      <section id="guide-chat" className="scroll-mt-20 rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
        Выберите точку маршрута и нажмите «Спросить ИИ-гида», чтобы задать вопрос об этом месте.
      </section>
    );
  }

  const busy = state.pending !== null;
  const sendingHere = state.pending?.placeId === place.id;
  const disabled = connection.kind !== "ready" || busy;

  return (
    <section id="guide-chat" aria-label="Чат с ИИ-гидом" className="min-w-0 scroll-mt-20 rounded-2xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1 basis-40">
          <h2 className="text-base font-normal leading-snug [overflow-wrap:anywhere]">ИИ-гид · {place.name}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Задавайте вопросы об истории и особенностях этого места.</p>
        </div>
        <button
          type="button"
          onClick={clearConversation}
          disabled={!conversation.messages.length && !conversation.draft}
          className="rounded-4xl border px-3 py-1.5 text-xs hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Очистить диалог
        </button>
      </div>

      <div className="px-4 pt-3" aria-live="polite">
        {connection.kind === "checking" && <p className="text-xs text-muted-foreground">Проверяем подключение ИИ-гида…</p>}
        {(connection.kind === "blocked" || connection.kind === "error") && (
          <div className="rounded-xl border bg-muted p-3 text-sm leading-6">
            <p>{connection.error.message}</p>
            <button
              type="button"
              onClick={refreshConnection}
              disabled={busy}
              className="mt-2 rounded-4xl border bg-card px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
            >
              Проверить подключение
            </button>
          </div>
        )}
      </div>

      <div ref={logRef} role="log" aria-live="polite" aria-relevant="additions text" aria-label="Сообщения диалога"
        className="flex max-h-[400px] min-w-0 flex-col gap-3 overflow-y-auto p-4">
        {conversation.messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {["Почему это место важно для Владивостока?", "Расскажи об истории этого места", "Что интересного в архитектуре?"].map((question) => (
              <button key={question} type="button" onClick={() => void send(question)} disabled={disabled}
                className="max-w-full rounded-2xl bg-secondary px-3 py-2 text-left text-xs leading-5 text-secondary-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50">
                {question}
              </button>
            ))}
          </div>
        )}
        {conversation.messages.map((message) => (
          <div key={message.id} className="flex min-w-0 flex-col gap-2">
            <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-6 whitespace-pre-wrap [overflow-wrap:anywhere] ${
              message.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-secondary text-secondary-foreground"
            }`}>
              {message.content}
            </div>
            {message.status === "failed" && message.error && (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-6 text-foreground">
                <p>{message.error.message}</p>
                {message.error.retryable && (
                  <button type="button" onClick={() => void send(undefined, message.id)} disabled={disabled}
                    className="mt-2 rounded-4xl border bg-card px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40">
                    Повторить
                  </button>
                )}
                {["CONFIG_MISSING", "CONFIG_INVALID", "AUTH_ERROR", "PROVIDER_CONFIG_ERROR"].includes(message.error.code) && (
                  <button type="button" onClick={refreshConnection} disabled={busy}
                    className="mt-2 rounded-4xl border bg-card px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40">
                    Проверить подключение
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {sendingHere && <p className="self-start rounded-2xl bg-secondary px-3 py-2 text-sm text-muted-foreground">Гид готовит ответ…</p>}
        {busy && !sendingHere && <p className="text-xs leading-5 text-muted-foreground">Гид отвечает на вопрос о другом месте. Дождитесь завершения запроса.</p>}
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="space-y-2 border-t p-3">
        <label htmlFor="guide-question" className="sr-only">Вопрос о месте</label>
        <textarea
          id="guide-question"
          value={conversation.draft}
          onChange={(event) => dispatch({ type: "draft", placeId: place.id, value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          maxLength={CHAT_LIMITS.questionChars}
          disabled={disabled}
          rows={2}
          placeholder={connection.kind === "ready" ? "Что вы хотите узнать об этом месте?" : "Чат недоступен без подключения ИИ"}
          className="min-h-20 w-full min-w-0 resize-y rounded-2xl border border-input bg-card px-3 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{conversation.draft.length} / {CHAT_LIMITS.questionChars}</span>
          <button type="submit" disabled={disabled || !conversation.draft.trim()}
            className="inline-flex min-h-10 items-center justify-center rounded-4xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-40">
            {sendingHere ? "Отправляем…" : "Отправить"}
          </button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">Диалог сохраняется до обновления страницы. Enter — отправить, Shift + Enter — новая строка.</p>
      </form>
    </section>
  );
}
