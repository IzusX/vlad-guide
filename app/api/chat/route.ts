import { NextResponse } from "next/server";
import { getPlace } from "@/lib/data";

// Server-side chat endpoint. Without a configured provider, returns reference information.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const placeId = body?.placeId as string | undefined;
  const question = (body?.question as string | undefined)?.trim();

  if (!placeId || !question) {
    return NextResponse.json({ error: "placeId и question обязательны" }, { status: 400 });
  }
  const place = getPlace(placeId);
  if (!place) return NextResponse.json({ error: "place не найден" }, { status: 404 });

  // Provider credentials are read only on the server.
  const apiUrl = process.env.AI_API_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;

  if (apiUrl && apiKey) {
    try {
      const r = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Ты — гид по Владивостоку. Отвечай только на основе Контекста. Если ответа нет — честно скажи "в моей базе нет этой информации" и не выдумывай даты/факты. Контекст: ${place.description}`,
            },
            { role: "user", content: question },
          ],
          temperature: 0.4,
        }),
      });
      const j = await r.json();
      const answer = j.choices?.[0]?.message?.content || j.answer || JSON.stringify(j);
      return NextResponse.json({ answer, source: "ai", placeId });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `Ошибка ИИ: ${msg}` }, { status: 502 });
    }
  }

  // Clearly distinguish reference information from a generated answer.
  const fallback = `ИИ-гид сейчас недоступен. Вот справочная информация о месте:\n\n${place.name}\n\n${place.short}\n\n${place.description}`;
  return NextResponse.json({ answer: fallback, source: "fallback", placeId });
}
