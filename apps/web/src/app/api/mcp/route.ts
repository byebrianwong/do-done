import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createDoDoneServer } from "@do-done/mcp-server";
import { createServiceSupabase } from "@/lib/supabase/service";

// The MCP SDK and Supabase both need Node APIs; never run this on the edge.
// No `dynamic` export: it was removed from route segment config in Next 16, and
// reading the Authorization header already opts this handler out of caching.
export const runtime = "nodejs";

const BEARER_PREFIX = "Bearer ";

/**
 * Constant-time bearer comparison. Length is compared first because
 * `timingSafeEqual` throws on a length mismatch; leaking token length is
 * acceptable, leaking a per-character match position is not.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function unauthorized(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized" },
    },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="do-done-mcp"' },
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
 * Hosted do-done MCP endpoint (Streamable HTTP).
 *
 * Single-user for now: the caller proves itself with a shared secret and every
 * request is scoped to `DO_DONE_USER_ID`. Swapping this guard for OAuth 2.1 —
 * deriving `userId` from a validated access token — is the only change needed
 * to make it multi-user.
 */
async function handle(request: Request): Promise<Response> {
  const expectedToken = process.env.MCP_BEARER_TOKEN;
  const userId = process.env.DO_DONE_USER_ID;

  if (!expectedToken || !userId) {
    console.error(
      "MCP route misconfigured: MCP_BEARER_TOKEN and DO_DONE_USER_ID must both be set"
    );
    return misconfigured();
  }

  const header = request.headers.get("authorization") ?? "";
  if (
    !header.startsWith(BEARER_PREFIX) ||
    !tokenMatches(header.slice(BEARER_PREFIX.length), expectedToken)
  ) {
    return unauthorized();
  }

  const server = createDoDoneServer({
    supabase: createServiceSupabase(),
    userId,
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
