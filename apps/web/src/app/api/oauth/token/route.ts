import { MCP_SCOPE } from "@/lib/oauth/config";
import { safeEqual, verifyPkceS256 } from "@/lib/oauth/crypto";
import {
  consumeAuthorizationCode,
  getClient,
  issueTokens,
  rotateRefreshToken,
  type IssuedTokens,
} from "@/lib/oauth/store";

export const runtime = "nodejs";

/** RFC 6749 §5.2 error shape. Always 400 with no-store. */
function oauthError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "cache-control": "no-store", pragma: "no-cache" } }
  );
}

function tokenResponse(tokens: IssuedTokens): Response {
  return Response.json(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.scope ?? MCP_SCOPE,
    },
    { headers: { "cache-control": "no-store", pragma: "no-cache" } }
  );
}

/**
 * Token endpoint: authorization_code and refresh_token grants.
 *
 * Clients here are public (no secret), so the security of the code grant rests
 * entirely on PKCE plus single-use codes — which is exactly why both are
 * enforced without exception below.
 */
export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    // RFC 6749 mandates application/x-www-form-urlencoded; formData() accepts
    // that as well as multipart, which some clients send.
    form = await request.formData();
  } catch {
    return oauthError("invalid_request", "Body must be form-encoded.");
  }

  const grantType = form.get("grant_type");
  const clientId = form.get("client_id");

  if (typeof clientId !== "string" || clientId.length === 0) {
    return oauthError("invalid_client", "client_id is required.", 401);
  }

  const client = await getClient(clientId);
  if (!client) {
    return oauthError("invalid_client", "Unknown client.", 401);
  }

  if (grantType === "authorization_code") {
    return handleAuthorizationCode(form, clientId);
  }
  if (grantType === "refresh_token") {
    return handleRefresh(form, clientId);
  }

  return oauthError(
    "unsupported_grant_type",
    "Supported grant types: authorization_code, refresh_token."
  );
}

async function handleAuthorizationCode(
  form: FormData,
  clientId: string
): Promise<Response> {
  const code = form.get("code");
  const codeVerifier = form.get("code_verifier");
  const redirectUri = form.get("redirect_uri");

  if (typeof code !== "string" || code.length === 0) {
    return oauthError("invalid_request", "code is required.");
  }
  if (typeof codeVerifier !== "string" || codeVerifier.length === 0) {
    return oauthError("invalid_request", "code_verifier is required (PKCE).");
  }

  // Consume first, validate second — deliberately. Burning the code even on a
  // failed check means a stolen code cannot be used to brute-force the PKCE
  // verifier: an attacker gets exactly one guess.
  const authRequest = await consumeAuthorizationCode(code);
  if (!authRequest) {
    return oauthError(
      "invalid_grant",
      "The authorization code is invalid, expired, or already used."
    );
  }

  if (!safeEqual(authRequest.client_id, clientId)) {
    return oauthError("invalid_grant", "This code was issued to another client.");
  }

  // RFC 6749 §4.1.3: if redirect_uri was used in the authorization request it
  // must be sent here and must match exactly — no loopback port leniency, since
  // this is a string comparison against what we already stored.
  if (typeof redirectUri === "string" && redirectUri.length > 0) {
    if (!safeEqual(authRequest.redirect_uri, redirectUri)) {
      return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
    }
  }

  if (!verifyPkceS256(codeVerifier, authRequest.code_challenge)) {
    return oauthError("invalid_grant", "PKCE verification failed.");
  }

  const tokens = await issueTokens({
    clientId: authRequest.client_id,
    userId: authRequest.user_id,
    scope: authRequest.scope,
    resource: authRequest.resource,
  });

  return tokenResponse(tokens);
}

async function handleRefresh(form: FormData, clientId: string): Promise<Response> {
  const refreshToken = form.get("refresh_token");

  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    return oauthError("invalid_request", "refresh_token is required.");
  }

  // Rotation: the presented token is revoked and a new pair issued, so a
  // replayed refresh token fails on the second use.
  const tokens = await rotateRefreshToken({ refreshToken, clientId });
  if (!tokens) {
    return oauthError(
      "invalid_grant",
      "The refresh token is invalid, expired, or already used."
    );
  }

  return tokenResponse(tokens);
}
