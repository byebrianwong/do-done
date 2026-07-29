/** Shared constants and URL helpers for the OAuth server. */

/** The single scope this server issues. Kept coarse: MCP access is all-or-nothing. */
export const MCP_SCOPE = "mcp";

/** Short-lived, because a leaked access token is replayable until it expires. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/** Long enough that a connector keeps working, with rotation on every use. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/** How long the user has to complete the consent screen. */
export const AUTH_REQUEST_TTL_SECONDS = 60 * 10;

/** How long an issued authorization code stays redeemable (RFC 6749 says ≤10 min). */
export const AUTH_CODE_TTL_SECONDS = 60 * 5;

/** Path of the MCP resource this server protects. */
export const MCP_RESOURCE_PATH = "/api/mcp";

/**
 * Public origin of this deployment.
 *
 * The issuer must be the URL clients actually reach, and it must be stable —
 * Claude compares it against the metadata it discovered. `APP_URL` wins when
 * set (already used for Google's calendar webhook); otherwise fall back to the
 * proxy headers Vercel populates, then the request URL itself for local dev.
 */
export function getBaseUrl(request: Request): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}

export function getResourceUrl(request: Request): string {
  return `${getBaseUrl(request)}${MCP_RESOURCE_PATH}`;
}

/**
 * Where a 401 from the MCP endpoint points clients for discovery (RFC 9728).
 * The path-suffixed form is what a resource at /api/mcp maps to.
 */
export function getProtectedResourceMetadataUrl(request: Request): string {
  return `${getBaseUrl(request)}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;
}
