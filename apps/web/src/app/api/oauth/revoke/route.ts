import { revokeToken } from "@/lib/oauth/store";

export const runtime = "nodejs";

/**
 * Token revocation (RFC 7009).
 *
 * The spec requires 200 even for tokens that are unknown, already revoked, or
 * malformed: a distinguishable response would let an unauthenticated caller
 * probe which token strings exist.
 */
export async function POST(request: Request): Promise<Response> {
  const ok = new Response(null, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return ok;
  }

  const token = form.get("token");
  if (typeof token !== "string" || token.length === 0) return ok;

  await revokeToken(token);
  return ok;
}
