import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "DoDone — plan your day, not just your list",
  description:
    "Type a task the way you'd say it. DoDone keeps hard deadlines separate from the day you plan to do the work, syncs both ways with your calendar, and talks to Claude. Try the live demo — no sign-up.",
};

/**
 * The public root.
 *
 * It used to redirect straight to /inbox, which meant the auth proxy bounced
 * every signed-out visitor to a bare login form — the app had no front door at
 * all. Now it's the landing page for everyone; a signed-in reader gets "Open
 * DoDone" where a stranger gets the sign-in form, so nobody is asked to log in
 * to an account they're already in.
 */
export default async function Home() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <LandingPage signedIn={!!user} />;
}
