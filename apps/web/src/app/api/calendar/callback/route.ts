import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { exchangeCodeForTokens } from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      `${origin}/settings?error=${encodeURIComponent(error ?? "no_code")}`
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  try {
    const tokens = await exchangeCodeForTokens(
      code,
      `${origin}/api/calendar/callback`
    );

    // Upsert into calendar_sync table
    const { error: upsertError } = await supabase
      .from("calendar_sync")
      .upsert(
        {
          user_id: user.id,
          google_refresh_token: tokens.refresh_token,
          google_access_token: tokens.access_token,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      return NextResponse.redirect(
        `${origin}/settings?error=${encodeURIComponent(upsertError.message)}`
      );
    }

    return NextResponse.redirect(`${origin}/settings?connected=1`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "exchange_failed";
    return NextResponse.redirect(
      `${origin}/settings?error=${encodeURIComponent(message)}`
    );
  }
}
