import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

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

  await supabase.from("calendar_sync").delete().eq("user_id", user.id);

  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/settings?disconnected=1`, {
    status: 303,
  });
}
