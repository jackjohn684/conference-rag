// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

// RAG step: answers a question using only the conference talks the browser retrieved.
// Request:  POST { "question": "...", "context_talks": [{ title, speaker, text }, ...] }
// Response: { "answer": "..." }

// Any logged-in user can call this, so cap how much text we forward to OpenAI (and pay for).
const MAX_TALKS = 5;
const MAX_CHARS_PER_TALK = 20000;

type Talk = { title?: string; speaker?: string; text?: string };

const SYSTEM_PROMPT = `You answer questions about talks from the General Conference of The Church of Jesus Christ of Latter-day Saints.
Use ONLY the conference talks provided by the user as your sources.
Cite the talks you draw from by title and speaker, for example: ("Title" — Speaker).
If the provided talks do not answer the question, say so plainly instead of guessing.
Keep the answer clear and concise.`;

function buildContext(talks: Talk[]): string {
  return talks
    .map((t, i) =>
      `Source ${i + 1}: "${t.title ?? "Untitled"}" — ${t.speaker ?? "Unknown speaker"}\n` +
      (t.text ?? "").slice(0, MAX_CHARS_PER_TALK)
    )
    .join("\n\n---\n\n");
}

Deno.serve(async (req: Request) => {
  // CORS preflight: the browser asks permission before the real POST
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const auth = await requireUser(req);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Request body must be JSON" }, 400);
  }

  const question = body?.question;
  if (typeof question !== "string" || question.trim() === "") {
    return jsonResponse({ error: "Missing or empty 'question'" }, 400);
  }

  // Also rejects app.js's page-load readiness check (context_talks: []) before it costs anything
  const talks = body?.context_talks;
  if (!Array.isArray(talks) || talks.length === 0) {
    return jsonResponse({ error: "'context_talks' must be a non-empty array" }, 400);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return jsonResponse({ error: "OPENAI_API_KEY is not set" }, 500);
  }

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Conference talks:\n\n${buildContext(talks.slice(0, MAX_TALKS))}\n\nQuestion: ${question}`,
        },
      ],
    }),
  });

  if (!openaiRes.ok) {
    const err = await openaiRes.json().catch(() => ({}));
    return jsonResponse({ error: err.error?.message ?? "OpenAI request failed" }, 502);
  }

  const data = await openaiRes.json();
  return jsonResponse({ answer: data.choices[0].message.content });
});
