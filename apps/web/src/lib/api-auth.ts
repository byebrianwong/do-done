import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Authenticate a route that serves both the web app and the mobile app.
 *
 * The browser sends a cookie session; the mobile app has no cookies and sends
 * `Authorization: Bearer <supabase access token>` instead. The bearer client
 * runs with the anon key plus the user's JWT, so RLS scopes every read exactly
 * as it would for a browser session — the route never gains privileges by
 * being called from mobile.
 *
 * Returns nulls rather than throwing; callers answer 401.
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<{ supabase: SupabaseClient | null; userId: string | null }> {
  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  if (bearer) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return { supabase: null, userId: null };
    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser(bearer);
    return { supabase, userId: user?.id ?? null };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}
