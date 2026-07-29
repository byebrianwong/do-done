import { z } from "zod";
import { hashIp, isAllowedRedirectUri } from "@/lib/oauth/crypto";
import { countRecentRegistrations, createClient } from "@/lib/oauth/store";

export const runtime = "nodejs";

/** Registrations allowed from one source per hour. */
const RATE_LIMIT_PER_HOUR = 10;
const MAX_REDIRECT_URIS = 10;

/**
 * RFC 7591 client metadata. Unknown fields are ignored rather than rejected —
 * clients send a superset (logo_uri, contacts, …) and the spec expects servers
 * to tolerate what they don't use.
 */
const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(200).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(MAX_REDIRECT_URIS),
});

function badRequest(error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    { status: 400 }
  );
}

/**
 * Dynamic Client Registration (RFC 7591).
 *
 * This endpoint is necessarily unauthenticated — Claude registers itself
 * before any user is involved, and the connector UI has no way to pre-share a
 * credential. Two things keep that from being a liability:
 *
 *   - Registration grants nothing on its own. A client can only ever act after
 *     a signed-in user approves it on the consent screen, and every issued
 *     token is bound to that user.
 *   - Per-source rate limiting caps junk registrations. The source IP is
 *     stored only as a salted hash, so the table holds no plaintext addresses.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_client_metadata", "Body must be JSON.");
  }

  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      "invalid_client_metadata",
      "redirect_uris must be a non-empty array of absolute URLs."
    );
  }

  const { client_name: clientName, redirect_uris: redirectUris } = parsed.data;

  // https everywhere, except loopback for native clients. This is what stops a
  // client from registering javascript:/data: or a plaintext http endpoint and
  // having authorization codes delivered there.
  const rejected = redirectUris.filter((uri) => !isAllowedRedirectUri(uri));
  if (rejected.length > 0) {
    return badRequest(
      "invalid_redirect_uri",
      "redirect_uris must be https, or http on a loopback address, and must not contain a fragment."
    );
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || null;
  // The service-role key is a server-only secret and never leaves the server,
  // so it works as salt material here; the goal is only to avoid storing
  // plaintext IPs, not to authenticate anything.
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ipHash = ip ? hashIp(ip, salt) : null;

  if (ipHash) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await countRecentRegistrations(ipHash, since);
    if (recent >= RATE_LIMIT_PER_HOUR) {
      return Response.json(
        {
          error: "invalid_client_metadata",
          error_description: "Too many client registrations. Try again later.",
        },
        { status: 429, headers: { "retry-after": "3600" } }
      );
    }
  }

  const client = await createClient({
    clientName: clientName ?? null,
    redirectUris,
    ipHash,
  });

  return Response.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types,
      response_types: ["code"],
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201, headers: { "cache-control": "no-store" } }
  );
}
