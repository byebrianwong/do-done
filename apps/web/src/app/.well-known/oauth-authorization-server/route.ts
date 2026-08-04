import { MCP_SCOPE, getBaseUrl } from "@/lib/oauth/config";

// Reads request headers to build absolute URLs, so it can't be static.
export const runtime = "nodejs";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * Claude fetches this to learn where to register, authorize, and exchange
 * codes. Two fields decide whether the connector flow can even start:
 * `code_challenge_methods_supported` must advertise S256, and
 * `registration_endpoint` must exist for dynamic client registration.
 */
export async function GET(request: Request): Promise<Response> {
  const base = getBaseUrl(request);

  return Response.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      revocation_endpoint: `${base}/api/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      // OAuth 2.1: "plain" is not offered, only S256.
      code_challenge_methods_supported: ["S256"],
      // Public clients only — Claude proves itself with PKCE, not a secret.
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [MCP_SCOPE],
      service_documentation: "https://github.com/byebrianwong/do-done",
    },
    {
      headers: {
        // Public, cacheable, but short enough that endpoint moves propagate.
        "cache-control": "public, max-age=300",
      },
    }
  );
}
