import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_LIMITS, chatError } from "../lib/chat.ts";
import { INITIAL_CHAT_STATE, chatReducer, conversationFor, historyFor } from "../lib/chat-state.ts";
import type { ChatState } from "../lib/chat-state.ts";

function start(state: ChatState, placeId: string, id: string, question = "Вопрос") {
  return chatReducer(state, { type: "start", placeId, messageId: id, question });
}

function complete(state: ChatState, placeId: string, id: string, answer = "Ответ") {
  return chatReducer(state, { type: "success", placeId, messageId: id, answer });
}

test("drafts and conversations are separate for each place", () => {
  let state = chatReducer(INITIAL_CHAT_STATE, { type: "draft", placeId: "station", value: "Вокзал" });
  state = chatReducer(state, { type: "draft", placeId: "arch", value: "Арка" });
  assert.equal(conversationFor(state, "station").draft, "Вокзал");
  assert.equal(conversationFor(state, "arch").draft, "Арка");
  assert.equal(conversationFor(state, "unknown").messages.length, 0);
});

test("pending request cannot be sent twice, even for another place", () => {
  const state = start(INITIAL_CHAT_STATE, "station", "one");
  assert.equal(start(state, "station", "two"), state);
  assert.equal(start(state, "arch", "two"), state);
  assert.equal(conversationFor(state, "station").messages.length, 1);
});

test("answer is stored for its original place after switching away", () => {
  let state = start(INITIAL_CHAT_STATE, "station", "one");
  state = chatReducer(state, { type: "draft", placeId: "arch", value: "Другой вопрос" });
  state = complete(state, "station", "one", "История вокзала");
  assert.equal(conversationFor(state, "station").messages[1].content, "История вокзала");
  assert.equal(conversationFor(state, "arch").messages.length, 0);
  assert.equal(state.pending, null);
});

test("retry keeps the failed question once and uses the same entry", () => {
  let state = start(INITIAL_CHAT_STATE, "station", "one", "Когда построили?");
  state = chatReducer(state, { type: "failure", placeId: "station", messageId: "one", error: chatError("RATE_LIMIT") });
  assert.equal(conversationFor(state, "station").messages[0].status, "failed");
  state = start(state, "station", "one", "When?");
  assert.equal(conversationFor(state, "station").messages.length, 1);
  assert.equal(conversationFor(state, "station").messages[0].content, "Когда построили?");
  state = complete(state, "station", "one");
  assert.equal(conversationFor(state, "station").messages.length, 2);
  assert.equal(conversationFor(state, "station").messages[0].error, undefined);
});

test("clearing a conversation ignores its late answer", () => {
  let state = start(INITIAL_CHAT_STATE, "station", "one");
  state = chatReducer(state, { type: "clear", placeId: "station" });
  const cleared = state;
  assert.equal(complete(state, "station", "one"), cleared);
  assert.equal(conversationFor(state, "station").messages.length, 0);
});

test("a cleared request cannot alter a new pending request", () => {
  let state = start(INITIAL_CHAT_STATE, "station", "one");
  state = chatReducer(state, { type: "clear", placeId: "station" });
  state = start(state, "arch", "two");
  assert.equal(complete(state, "station", "one"), state);
  assert.deepEqual(state.pending, { placeId: "arch", messageId: "two" });
});

test("history includes only completed pairs and at most five recent turns", () => {
  let state = INITIAL_CHAT_STATE;
  for (let index = 0; index < 7; index += 1) {
    state = start(state, "station", `q-${index}`, `Вопрос ${index}`);
    state = complete(state, "station", `q-${index}`, `Ответ ${index}`);
  }
  state = start(state, "station", "failed", "Неудачный вопрос");
  state = chatReducer(state, { type: "failure", placeId: "station", messageId: "failed", error: chatError("TIMEOUT") });
  const history = historyFor(conversationFor(state, "station"));
  assert.equal(history.length, CHAT_LIMITS.historyMessages);
  assert.equal(history[0].content, "Вопрос 2");
  assert.equal(history[9].content, "Ответ 6");
  assert.ok(history.every((message) => !message.content.includes("Неудачный")));
});

test("retry history excludes subsequent turns", () => {
  let state = start(INITIAL_CHAT_STATE, "station", "before");
  state = complete(state, "station", "before");
  state = start(state, "station", "failed");
  state = chatReducer(state, { type: "failure", placeId: "station", messageId: "failed", error: chatError("TIMEOUT") });
  state = start(state, "station", "after");
  state = complete(state, "station", "after");
  assert.equal(historyFor(conversationFor(state, "station"), "failed").length, 2);
  assert.equal(historyFor(conversationFor(state, "station")).length, 4);
});
