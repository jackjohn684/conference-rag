import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "./cors.ts";

// The function is deployed with --no-verify-jwt (see steps/05), so we check the
// user's token ourselves by asking Supabase Auth who it belongs to.
// Returns the user, or a 401 Response to send back.
export async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { error: jsonResponse({ error: "Missing Authorization header" }, 401) };
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { error: jsonResponse({ error: "Invalid or expired token" }, 401) };
  }

  return { user };
}
