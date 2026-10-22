"use client";
import { useState } from "react";
import type { Place } from "@/lib/types";

type Msg = { role: "user" | "assistant"; content: string };

export function Chat({ place }: { place: Place | null }) {
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(prompt?: string) {
    const text = prompt ?? q;
    if (!text.trim() || !place) return;
    setError(null);
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setQ("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: place.id, question: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка запроса");
      setMsgs([...next, { role: "assistant", content: data.answer }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (!place) {
    return (
      <div className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
        Выбери точку маршрута и нажми «Спросить ИИ-гида», чтобы задать вопрос по этому месту.
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-2xl border bg-card">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-medium">ИИ-гид · {place.name}</div>
        <div className="text-xs text-muted-foreground">Задайте вопрос об истории или особенностях этого места.</div>
      </div>

      <div className="flex max-h-[320px] flex-col gap-3 overflow-auto p-4">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[
              "Почему это место важно для Владивостока?",
              "Что рядом посмотреть?",
              "Расскажи про архитектуру",
              "Сколько времени заложить?",
            ].map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground hover:bg-secondary/60"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-6 ${
              m.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-secondary text-secondary-foreground"
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && <div className="self-start rounded-2xl bg-secondary px-3 py-2 text-sm text-muted-foreground">Думаю…</div>}
        {error && <div className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      </div>

      <div className="flex gap-2 border-t p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Спроси про: ${place.name}`}
          className="h-10 flex-1 rounded-3xl border border-input bg-card px-4 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        />
        <button
          onClick={() => send()}
          disabled={loading || !q.trim()}
          className="rounded-4xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-40 disabled:pointer-events-none"
        >
          Отправить
        </button>
      </div>
    </div>
  );
}
