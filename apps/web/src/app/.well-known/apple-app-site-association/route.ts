/**
 * Apple App Site Association — the iOS half of app↔site credential linking.
 *
 * Serving this lets iOS (and password managers like 1Password that follow the
 * same association) treat a saved dodone.byebrianwong.com login as a match for
 * the DoDone app, instead of two unrelated items. The app side is the
 * `webcredentials:` entry in `associatedDomains` in apps/mobile/app.config.ts.
 *
 * Apple requires this at /.well-known/apple-app-site-association, served over
 * HTTPS as application/json with **no** redirect and no file extension.
 *
 * Configured via APPLE_APP_ID ("<TeamID>.<bundleId>", e.g.
 * "ABCDE12345.com.beamer408.dodone"). When it is unset we 404 rather than
 * serve a placeholder: iOS caches association files, and a malformed one is
 * worse than a missing one.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const appId = process.env.APPLE_APP_ID;

  if (!appId) {
    return new Response("Not found", { status: 404 });
  }

  return Response.json(
    {
      webcredentials: {
        apps: [appId],
      },
    },
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=3600",
      },
    }
  );
}
