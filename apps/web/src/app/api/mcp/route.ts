import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createDoDoneServer } from "@do-done/mcp-server";
import { getBaseUrl, getProtectedResourceMetadataUrl } from "@/lib/oauth/config";
import { safeEqual } from "@/lib/oauth/crypto";
import { resolveAccessToken } from "@/lib/oauth/store";
import { createServiceSupabase } from "@/lib/supabase/service";

// The MCP SDK and Supabase both need Node APIs; never run this on the edge.
// No `dynamic` export: it was removed from route segment config in Next 16, and
// reading the Authorization header already opts this handler out of caching.
export const runtime = "nodejs";

const BEARER_PREFIX = "Bearer ";

/**
 * 401 that tells the client how to authenticate.
 *
 * The `resource_metadata` pointer is the load-bearing part: per RFC 9728 it is
 * how Claude discovers the authorization server and starts the OAuth flow.
 * Without it a client sees only an opaque "unauthorized" and gives up — which
 * is exactly what the static-token-only version of this route did.
 */
function unauthorized(request: Request, description: string): Response {
  const metadataUrl = getProtectedResourceMetadataUrl(request);
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized" },
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer realm="do-done-mcp", error="invalid_token", error_description="${description}", resource_metadata="${metadataUrl}"`,
      },
    }
  );
}

function misconfigured(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "Server misconfigured" },
    },
    { status: 500 }
  );
}

/**
 * Resolve the caller to a user id, or null.
 *
 * Two accepted credentials, in priority order:
 *
 *   1. An OAuth access token issued by this server. The user comes from the
 *      token, which is what makes the endpoint multi-user.
 *   2. The legacy static `MCP_BEARER_TOKEN`, scoped to `DO_DONE_USER_ID`.
 *      Optional — unset either env var and this path disappears. It is kept
 *      because Claude Code can consume a header-authenticated remote server
 *      directly, with no browser round trip.
 */
async function authenticate(token: string): Promise<string | null> {
  const context = await resolveAccessToken(token);
  if (context) return context.userId;

  const staticToken = process.env.MCP_BEARER_TOKEN;
  const staticUserId = process.env.DO_DONE_USER_ID;
  if (staticToken && staticUserId && safeEqual(token, staticToken)) {
    return staticUserId;
  }

  return null;
}

/**
 * Hosted do-done MCP endpoint (Streamable HTTP).
 *
 * A fresh server is built per request and bound to the authenticated user,
 * because the tool registrars capture their user id at construction time —
 * reusing one instance across requests would serve one user's tasks to another.
 */
async function handle(request: Request): Promise<Response> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error("MCP route misconfigured: Supabase env vars are missing");
    return misconfigured();
  }

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith(BEARER_PREFIX)) {
    return unauthorized(request, "A bearer token is required.");
  }

  const userId = await authenticate(header.slice(BEARER_PREFIX.length));
  if (!userId) {
    return unauthorized(request, "The access token is invalid or expired.");
  }

  // `baseUrl` is branding only: it points the connector's icon at this
  // deployment's /icon.png and links the entry back to the app.
  const server = createDoDoneServer({
    supabase: createServiceSupabase(),
    userId,
    baseUrl: getBaseUrl(request),
  });

  // Stateless: each serverless invocation is independent, so there is no
  // cross-request session state to hand out or validate.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handle(request);
}
