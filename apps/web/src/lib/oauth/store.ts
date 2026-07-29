import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./config";
import { generateClientId, generateToken, hashToken } from "./crypto";

/**
 * Database access for the OAuth server.
 *
 * These are web-app infrastructure tables, not domain data, so they are
 * queried here directly rather than through `@do-done/api-client` — same
 * treatment as `calendar_sync`. Everything runs as the service role because
 * the tables are RLS-locked with no policies, and because the token endpoint
 * has no user session to act on behalf of.
 */

export interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
}

export interface AuthorizationRequest {
  id: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  resource: string | null;
  state: string | null;
  approved_at: string | null;
  consumed_at: string | null;
  expires_at: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string | null;
}

export interface AccessTokenContext {
  userId: string;
  clientId: string;
  scope: string | null;
  resource: string | null;
}

function db(): SupabaseClient {
  return createServiceSupabase();
}

const CLIENT_COLUMNS =
  "client_id, client_name, redirect_uris, grant_types, token_endpoint_auth_method";

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const { data, error } = await db()
    .from("oauth_clients")
    .select(CLIENT_COLUMNS)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) throw new Error(`oauth: client lookup failed: ${error.message}`);
  return (data as OAuthClient | null) ?? null;
}

/** Registrations from one source in a window — the rate-limit input for DCR. */
export async function countRecentRegistrations(
  ipHash: string,
  sinceIso: string
): Promise<number> {
  const { count, error } = await db()
    .from("oauth_clients")
    .select("client_id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", sinceIso);

  if (error) throw new Error(`oauth: registration count failed: ${error.message}`);
  return count ?? 0;
}

export async function createClient(params: {
  clientName: string | null;
  redirectUris: string[];
  ipHash: string | null;
}): Promise<OAuthClient> {
  const clientId = generateClientId();

  const { data, error } = await db()
    .from("oauth_clients")
    .insert({
      client_id: clientId,
      client_name: params.clientName,
      redirect_uris: params.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
      ip_hash: params.ipHash,
    })
    .select(CLIENT_COLUMNS)
    .single();

  if (error) throw new Error(`oauth: client registration failed: ${error.message}`);
  return data as OAuthClient;
}

export async function createAuthorizationRequest(params: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string | null;
  resource: string | null;
  state: string | null;
  expiresAt: Date;
}): Promise<string> {
  const { data, error } = await db()
    .from("oauth_authorization_requests")
    .insert({
      client_id: params.clientId,
      user_id: params.userId,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: params.codeChallengeMethod,
      scope: params.scope,
      resource: params.resource,
      state: params.state,
      expires_at: params.expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`oauth: could not start authorization: ${error.message}`);
  return (data as { id: string }).id;
}

export async function getAuthorizationRequest(
  id: string
): Promise<AuthorizationRequest | null> {
  const { data, error } = await db()
    .from("oauth_authorization_requests")
    .select(
      "id, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, state, approved_at, consumed_at, expires_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`oauth: authorization lookup failed: ${error.message}`);
  return (data as AuthorizationRequest | null) ?? null;
}

/**
 * Attach a freshly minted code to a pending request.
 *
 * Guarded on `approved_at is null` so a replayed consent POST cannot mint a
 * second code for the same request.
 */
export async function approveAuthorizationRequest(params: {
  id: string;
  userId: string;
}): Promise<string | null> {
  const code = generateToken();
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000);

  const { data, error } = await db()
    .from("oauth_authorization_requests")
    .update({
      code_hash: hashToken(code),
      approved_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .is("approved_at", null)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`oauth: approval failed: ${error.message}`);
  if (!data) return null;
  return code;
}

/**
 * Redeem an authorization code, exactly once.
 *
 * The single-use guarantee is the `is("consumed_at", null)` filter on an
 * UPDATE ... RETURNING: Postgres serialises concurrent updates to the row, so
 * a second redemption re-checks the predicate after the first commits and
 * matches nothing. Doing this as a read-then-write would be a race.
 */
export async function consumeAuthorizationCode(
  code: string
): Promise<AuthorizationRequest | null> {
  const { data, error } = await db()
    .from("oauth_authorization_requests")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code_hash", hashToken(code))
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select(
      "id, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, state, approved_at, consumed_at, expires_at"
    )
    .maybeSingle();

  if (error) throw new Error(`oauth: code exchange failed: ${error.message}`);
  return (data as AuthorizationRequest | null) ?? null;
}

export async function issueTokens(params: {
  clientId: string;
  userId: string;
  scope: string | null;
  resource: string | null;
}): Promise<IssuedTokens> {
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const now = Date.now();

  const { error } = await db()
    .from("oauth_tokens")
    .insert({
      access_token_hash: hashToken(accessToken),
      refresh_token_hash: hashToken(refreshToken),
      client_id: params.clientId,
      user_id: params.userId,
      scope: params.scope,
      resource: params.resource,
      access_expires_at: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      refresh_expires_at: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
    });

  if (error) throw new Error(`oauth: token issuance failed: ${error.message}`);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scope: params.scope,
  };
}

/** Resolve a presented access token to its owner, or null if unusable. */
export async function resolveAccessToken(
  token: string
): Promise<AccessTokenContext | null> {
  const { data, error } = await db()
    .from("oauth_tokens")
    .select("user_id, client_id, scope, resource")
    .eq("access_token_hash", hashToken(token))
    .is("revoked_at", null)
    .gt("access_expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw new Error(`oauth: token lookup failed: ${error.message}`);
  if (!data) return null;

  const row = data as {
    user_id: string;
    client_id: string;
    scope: string | null;
    resource: string | null;
  };
  return {
    userId: row.user_id,
    clientId: row.client_id,
    scope: row.scope,
    resource: row.resource,
  };
}

/**
 * Rotate a refresh token: revoke the presented pair and issue a new one.
 *
 * Rotation is guarded the same way code consumption is — the revoke is an
 * atomic conditional UPDATE, so a refresh token replayed twice only succeeds
 * once. Returns null when the token is unknown, expired, or already used.
 */
export async function rotateRefreshToken(params: {
  refreshToken: string;
  clientId: string;
}): Promise<IssuedTokens | null> {
  const { data, error } = await db()
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("refresh_token_hash", hashToken(params.refreshToken))
    .eq("client_id", params.clientId)
    .is("revoked_at", null)
    .gt("refresh_expires_at", new Date().toISOString())
    .select("user_id, client_id, scope, resource")
    .maybeSingle();

  if (error) throw new Error(`oauth: refresh failed: ${error.message}`);
  if (!data) return null;

  const row = data as {
    user_id: string;
    client_id: string;
    scope: string | null;
    resource: string | null;
  };

  return issueTokens({
    clientId: row.client_id,
    userId: row.user_id,
    scope: row.scope,
    resource: row.resource,
  });
}

/** Revoke by access or refresh token (RFC 7009 tolerates either). */
export async function revokeToken(token: string): Promise<void> {
  const hash = hashToken(token);
  const revokedAt = new Date().toISOString();

  const { error } = await db()
    .from("oauth_tokens")
    .update({ revoked_at: revokedAt })
    .or(`access_token_hash.eq.${hash},refresh_token_hash.eq.${hash}`)
    .is("revoked_at", null);

  if (error) throw new Error(`oauth: revocation failed: ${error.message}`);
}
