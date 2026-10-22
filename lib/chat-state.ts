import { CHAT_LIMITS } from "./chat.ts";
import type { ChatError, ChatMessage } from "./chat.ts";

export type ChatEntry = ChatMessage & {
  id: string;
  status: "sent" | "pending" | "failed";
  error?: ChatError;
};

export type Conversation = { draft: string; messages: ChatEntry[] };
export type ChatState = {
  conversations: Record<string, Conversation>;
  pending: { placeId: string; messageId: string } | null;
};

export type ChatAction =
  | { type: "draft"; placeId: string; value: string }
  | { type: "start"; placeId: string; messageId: string; question: string }
  | { type: "success"; placeId: string; messageId: string; answer: string }
  | { type: "failure"; placeId: string; messageId: string; error: ChatError }
  | { type: "clear"; placeId: string };

export const INITIAL_CHAT_STATE: ChatState = { conversations: {}, pending: null };
const EMPTY_CONVERSATION: Conversation = { draft: "", messages: [] };

export function conversationFor(state: ChatState, placeId: string): Conversation {
  return state.conversations[placeId] ?? EMPTY_CONVERSATION;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  const conversation = conversationFor(state, action.placeId);
  const save = (value: Conversation, pending = state.pending): ChatState => ({
    conversations: { ...state.conversations, [action.placeId]: value },
    pending,
  });

  if (action.type === "draft") {
    return save({ ...conversation, draft: action.value });
  }

  if (action.type === "clear") {
    return save(
      { draft: "", messages: [] },
      state.pending?.placeId === action.placeId ? null : state.pending,
    );
  }

  if (action.type === "start") {
    if (state.pending) return state;
    const existing = conversation.messages.find((message) => message.id === action.messageId);
    if (existing && (existing.role !== "user" || existing.status !== "failed")) return state;
    const message: ChatEntry = {
      id: action.messageId,
      role: "user",
      content: existing?.content ?? action.question,
      status: "pending",
    };
    return save(
      {
        draft: existing ? conversation.draft : "",
        messages: existing
          ? conversation.messages.map((entry) => entry.id === message.id ? message : entry)
          : [...conversation.messages, message],
      },
      { placeId: action.placeId, messageId: action.messageId },
    );
  }

  // Ignore late completions after clearing a conversation or starting another request.
  if (state.pending?.placeId !== action.placeId || state.pending.messageId !== action.messageId) {
    return state;
  }
  const index = conversation.messages.findIndex((message) => message.id === action.messageId);
  if (index < 0) return state;
  const messages = [...conversation.messages];

  if (action.type === "success") {
    messages[index] = { ...messages[index], status: "sent", error: undefined };
    messages.splice(index + 1, 0, {
      id: `${action.messageId}-answer`,
      role: "assistant",
      content: action.answer,
      status: "sent",
    });
  } else {
    messages[index] = { ...messages[index], status: "failed", error: action.error };
  }
  return save({ ...conversation, messages }, null);
}

export function historyFor(conversation: Conversation, beforeMessageId?: string): ChatMessage[] {
  const end = beforeMessageId
    ? conversation.messages.findIndex((message) => message.id === beforeMessageId)
    : conversation.messages.length;
  const messages = conversation.messages.slice(0, end < 0 ? 0 : end);
  const history: ChatMessage[] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (user.role === "user" && user.status === "sent"
      && assistant.role === "assistant" && assistant.status === "sent") {
      history.push({ role: "user", content: user.content });
      history.push({ role: "assistant", content: assistant.content });
      index += 1;
    }
  }
  return history.slice(-CHAT_LIMITS.historyMessages);
}
