import { MCP_RESOURCE_PATH, MCP_SCOPE, getBaseUrl, getResourceUrl } from "@/lib/oauth/config";

export const runtime = "nodejs";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * This is the first hop of discovery: the 401 from /api/mcp points here, and
 * this document points at the authorization server.
 *
 * Served from an optional catch-all because clients probe two shapes — the
 * bare `/.well-known/oauth-protected-resource` and the path-suffixed
 * `/.well-known/oauth-protected-resource/api/mcp` that RFC 9728 derives from
 * the resource URL. Both describe the same resource, so both are answered
 * here; anything else 404s rather than implying we protect it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
): Promise<Response> {
  const { path } = await params;
  const suffix = path?.length ? `/${path.join("/")}` : "";

  if (suffix && suffix !== MCP_RESOURCE_PATH) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(
    {
      resource: getResourceUrl(request),
      authorization_servers: [getBaseUrl(request)],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ["header"],
    },
    { headers: { "cache-control": "public, max-age=300" } }
  );
}
