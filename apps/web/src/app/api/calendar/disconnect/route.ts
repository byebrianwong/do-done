import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { stopChannel } from "@/lib/google-calendar";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), {
      status: 303,
    });
  }

  // Tear down the Google push channel before dropping our record of it.
  const { data: sync } = await supabase
    .from("calendar_sync")
    .select("google_refresh_token, watch_channel_id, watch_resource_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (sync?.watch_channel_id && sync?.watch_resource_id) {
    await stopChannel(
      sync.google_refresh_token,
      sync.watch_channel_id,
      sync.watch_resource_id
    );
  }

  await supabase.from("calendar_sync").delete().eq("user_id", user.id);

  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/settings?disconnected=1`, {
    status: 303,
  });
}
