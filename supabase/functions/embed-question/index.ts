// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

// Turns a question into an embedding vector so the browser can run match_sentences().
// Request:  POST { "question": "..." }  (with the logged-in user's token)
// Response: { "embedding": [ ...1536 numbers ] }
Deno.serve(async (req: Request) => {
  // CORS preflight: the browser asks permission before the real POST
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Only logged-in users get to spend our OpenAI credits
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

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return jsonResponse({ error: "OPENAI_API_KEY is not set" }, 500);
  }

  // Must be the same model used in scripts/04_embed_data.py, or the vectors won't be comparable
  const openaiRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: question,
    }),
  });
  if (!openaiRes.ok) {
    const err = await openaiRes.json().catch(() => ({}));
    return jsonResponse({ error: err.error?.message ?? "OpenAI request failed" }, 502);
  }

  const data = await openaiRes.json();
  return jsonResponse({ embedding: data.data[0].embedding });
});
