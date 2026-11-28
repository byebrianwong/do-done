import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  // Sign out of this browser only. The default scope is 'global', which
  // revokes every session the person has. This Supabase project is shared
  // with the pantry app, and so are its users, so a global sign-out here
  // would also sign them out of the pantry app and out of DoDone on their
  // phone.
  await supabase.auth.signOut({ scope: "local" });
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/login`, { status: 303 });
}
