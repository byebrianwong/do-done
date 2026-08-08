import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Paths that skip the auth redirect. Besides the login/auth flows, the calendar
// worker and webhook are server-to-server endpoints (called by pg_cron and
// Google, with no user session) — they authenticate via their own secrets:
// the cron secret header and the Google channel token, respectively. The MCP
// endpoint is the same shape: Claude calls it with no cookies, proving itself
// with a bearer token that the route checks itself. Redirecting it to /login
// would turn every MCP call into an HTML 307.
//
// /.well-known serves two anonymous audiences: the app↔site association files
// Apple and Google fetch (which must not redirect, per Apple's spec), and the
// OAuth discovery documents.
//
// The remaining OAuth paths are listed for two different reasons:
//   - /api/oauth/{register,token,revoke} are genuinely unauthenticated —
//     registration and token exchange happen with no cookies.
//   - /oauth/authorize and /api/oauth/authorize DO need a session, but they
//     handle that themselves so they can bounce through /login?next=… and come
//     back to the same authorization request. A blind proxy redirect would
//     drop the OAuth parameters and strand the user on /inbox.
//
// `/demo` is the app itself, running against an in-memory sandbox — see
// `lib/demo/mode.ts`. It reaches Supabase for nothing, so there is no session
// for it to need, and bouncing it to /login would defeat the entire point of
// having it.
//
// The landing page at `/` is listed separately below: every entry here is a
// `startsWith` test, and "/" is a prefix of every path there is.
const PUBLIC_PATHS = [
  "/login",
  "/demo",
  "/auth/callback",
  "/auth/signout",
  "/api/calendar/worker",
  "/api/calendar/webhook",
  "/api/mcp",
  "/.well-known",
  "/oauth/authorize",
  "/api/oauth/",
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
  const isPublic =
    path === "/" || PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Carry the destination through the sign-in. Without this, a shared task
    // link handed to someone who happens to be signed out lands them on their
    // inbox with no idea what they were sent — the link is spent. `safeNext`
    // on the login page is what keeps this from being an open redirector.
    const dest = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    url.search = dest === "/" ? "" : `?next=${encodeURIComponent(dest)}`;
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/inbox";
    return NextResponse.redirect(url);
  }

  return response;
}
