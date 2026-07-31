import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Paths that skip the auth redirect. Besides the login/auth flows, the calendar
// worker and webhook are server-to-server endpoints (called by pg_cron and
// Google, with no user session) — they authenticate via their own secrets:
// the cron secret header and the Google channel token, respectively. The MCP
// endpoint is the same shape: Claude calls it with no cookies, proving itself
// with the MCP_BEARER_TOKEN that the route checks itself. Redirecting it to
// /login would turn every MCP call into an HTML 307.
//
// /.well-known holds the app↔site association files that Apple and Google
// fetch anonymously (and that must not redirect, per Apple's spec).
const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/auth/signout",
  "/api/calendar/worker",
  "/api/calendar/webhook",
  "/api/mcp",
  "/.well-known",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() must be called between client creation and response return.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/inbox";
    return NextResponse.redirect(url);
  }

  return response;
}
