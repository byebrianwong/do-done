import {
  approveAuthorizationRequest,
  getAuthorizationRequest,
} from "@/lib/oauth/store";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

function fail(message: string, status: number): Response {
  return Response.json({ error: "invalid_request", error_description: message }, { status });
}

/**
 * Records the user's decision on the consent screen.
 *
 * Everything this handler acts on is re-read from the database via
 * `request_id`; the form contributes only that id and the decision. So a
 * tampered form cannot change the client, the redirect target, or the PKCE
 * challenge — those were fixed when the request row was created.
 *
 * CSRF defence is the pairing of two facts: `request_id` is an unguessable
 * UUID, and the row is bound to a `user_id` that must match the current
 * session. A cross-site page can neither guess the id nor act as another user.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const requestId = form.get("request_id");
  const decision = form.get("decision");

  if (typeof requestId !== "string" || typeof decision !== "string") {
    return fail("Missing request_id or decision.", 400);
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail("You must be signed in to authorize an application.", 401);
  }

  const authRequest = await getAuthorizationRequest(requestId);
  if (!authRequest || authRequest.user_id !== user.id) {
    // Same response for "no such request" and "not yours" — no probing.
    return fail("Unknown authorization request.", 404);
  }

  if (new Date(authRequest.expires_at).getTime() < Date.now()) {
    return fail("This authorization request has expired. Please start again.", 400);
  }

  const target = new URL(authRequest.redirect_uri);
  if (authRequest.state) target.searchParams.set("state", authRequest.state);

  if (decision !== "approve") {
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_description", "The user denied the request.");
    return Response.redirect(target.toString(), 303);
  }

  const code = await approveAuthorizationRequest({
    id: authRequest.id,
    userId: user.id,
  });

  if (!code) {
    // approved_at was already set — a double-submitted consent form.
    return fail("This authorization request has already been used.", 400);
  }

  target.searchParams.set("code", code);
  // 303 so the browser follows with GET after this POST.
  return Response.redirect(target.toString(), 303);
}
