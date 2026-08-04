import { redirect } from "next/navigation";
import { AUTH_REQUEST_TTL_SECONDS, MCP_SCOPE } from "@/lib/oauth/config";
import { redirectUriMatches } from "@/lib/oauth/crypto";
import { createAuthorizationRequest, getClient } from "@/lib/oauth/store";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** A dead end the user can read, for errors we must not bounce to a redirect_uri. */
function FatalError({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <div className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-800 p-8">
        <h1 className="text-lg font-semibold mb-2">{title}</h1>
        <p className="text-sm text-neutral-500">{detail}</p>
      </div>
    </main>
  );
}

/**
 * The consent screen — the human checkpoint of the whole OAuth flow.
 *
 * Error handling here follows RFC 6749 §4.1.2.1, which splits failures in two:
 *
 *   - A bad `client_id` or an unregistered `redirect_uri` means we cannot trust
 *     where a response would go, so we MUST render the error instead of
 *     redirecting. Redirecting on an unvalidated URI is what turns an
 *     authorization server into an open redirector.
 *   - Once the redirect_uri is known-good, every other failure goes back to the
 *     client as `?error=…`, which is what lets Claude show a real message.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const clientId = first(params.client_id);
  const redirectUri = first(params.redirect_uri);
  const responseType = first(params.response_type);
  const codeChallenge = first(params.code_challenge);
  const codeChallengeMethod = first(params.code_challenge_method);
  const state = first(params.state);
  const scope = first(params.scope);
  const resource = first(params.resource);

  if (!clientId || !redirectUri) {
    return (
      <FatalError
        title="Invalid authorization request"
        detail="Missing client_id or redirect_uri. Nothing was authorized."
      />
    );
  }

  const client = await getClient(clientId);
  if (!client) {
    return (
      <FatalError
        title="Unknown application"
        detail="This application is not registered with DoDone. Nothing was authorized."
      />
    );
  }

  const uriIsRegistered = client.redirect_uris.some((registered) =>
    redirectUriMatches(registered, redirectUri)
  );
  if (!uriIsRegistered) {
    return (
      <FatalError
        title="Invalid redirect URI"
        detail="This application asked to be sent somewhere it has not registered. Nothing was authorized."
      />
    );
  }

  // Past this point the redirect target is trusted, so failures can be
  // reported to the client the way the spec expects.
  const bounce = (error: string, description: string): never => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    redirect(url.toString());
  };

  if (responseType !== "code") {
    bounce("unsupported_response_type", "Only the authorization code flow is supported.");
  }
  if (!codeChallenge) {
    bounce("invalid_request", "PKCE is required: code_challenge is missing.");
  }
  if (codeChallengeMethod !== "S256") {
    bounce("invalid_request", "code_challenge_method must be S256.");
  }
  if (scope && !scope.split(/\s+/).includes(MCP_SCOPE)) {
    bounce("invalid_scope", `The only supported scope is "${MCP_SCOPE}".`);
  }

  // Consent requires knowing who is consenting. Bounce through login and come
  // back to this exact URL so the authorization parameters survive.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const selfUrl = new URL("/oauth/authorize", "http://placeholder");
    for (const [key, value] of Object.entries(params)) {
      const v = first(value);
      if (v !== null) selfUrl.searchParams.set(key, v);
    }
    const next = `${selfUrl.pathname}${selfUrl.search}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const requestId = await createAuthorizationRequest({
    clientId: client.client_id,
    userId: user.id,
    redirectUri,
    codeChallenge: codeChallenge!,
    codeChallengeMethod: "S256",
    scope: scope ?? MCP_SCOPE,
    resource,
    state,
    expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_SECONDS * 1000),
  });

  // client_name is attacker-controlled (registration is open), so it is shown
  // as a plain string — React escapes it — alongside the redirect host, which
  // is the part a user can actually use to spot an impostor.
  const redirectHost = new URL(redirectUri).host;

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-indigo-500 mb-1">DoDone</h1>
          <p className="text-sm text-neutral-500">Authorize access</p>
        </div>

        <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-800 p-8">
          <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-6">
            <span className="font-semibold">
              {client.client_name || "An application"}
            </span>{" "}
            wants to access your DoDone tasks.
          </p>

          <dl className="text-xs space-y-3 mb-6 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg p-4">
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Account</dt>
              <dd className="text-neutral-800 dark:text-neutral-200 truncate">
                {user.email}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Redirects to</dt>
              <dd className="text-neutral-800 dark:text-neutral-200 truncate">
                {redirectHost}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Access</dt>
              <dd className="text-neutral-800 dark:text-neutral-200">
                Read and write tasks
              </dd>
            </div>
          </dl>

          <p className="text-xs text-neutral-500 mb-6">
            Only approve this if you started it. Approving lets this application
            read, create, and complete your tasks until you revoke it.
          </p>

          {/* A plain form post — no JS needed, and the unguessable request_id
              (bound to this user server-side) is what prevents a cross-site
              page from silently approving on their behalf. */}
          <form method="POST" action="/api/oauth/authorize" className="flex gap-3">
            <input type="hidden" name="request_id" value={requestId} />
            <button
              type="submit"
              name="decision"
              value="deny"
              className="flex-1 px-4 py-2.5 border border-neutral-300 dark:border-neutral-700 text-sm font-medium rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
            >
              Deny
            </button>
            <button
              type="submit"
              name="decision"
              value="approve"
              className="flex-1 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition"
            >
              Approve
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
