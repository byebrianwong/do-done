import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Only same-origin relative paths may be returned to. The OAuth consent flow
 * routes through here (login → callback → back to /oauth/authorize), so this
 * parameter is now attacker-reachable; anything absolute or protocol-relative
 * would make this an open redirector.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/inbox";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/inbox";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
