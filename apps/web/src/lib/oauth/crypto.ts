import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Credential primitives for the OAuth server.
 *
 * Two rules run through this file:
 *   1. Nothing secret is ever stored in plaintext — the DB holds SHA-256
 *      hashes, so a table dump cannot be replayed against the token endpoint.
 *      Plain SHA-256 (not a password KDF) is correct here: these are
 *      high-entropy random strings, not user-chosen passwords, so there is no
 *      dictionary to attack and the lookup has to stay fast.
 *   2. Anything compared against attacker-supplied input is compared in
 *      constant time.
 */

/** 32 bytes of CSPRNG output, base64url — the shape of every credential here. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Opaque client identifiers are public, but still unguessable. */
export function generateClientId(): string {
  return `ddc_${randomBytes(16).toString("base64url")}`;
}

/** The only form in which a credential is allowed to reach the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

/**
 * Constant-time string compare. Length is checked first because
 * `timingSafeEqual` throws on mismatched buffers; that leaks length only,
 * which is not sensitive for fixed-format credentials.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a PKCE code_verifier against the stored challenge (RFC 7636, S256).
 *
 * challenge == BASE64URL(SHA256(ASCII(verifier))). Only S256 is accepted —
 * OAuth 2.1 removes the "plain" method, and silently accepting it would let a
 * network attacker who intercepted the authorization code redeem it.
 */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  // RFC 7636 §4.1: 43–128 characters from the unreserved set.
  if (verifier.length < 43 || verifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;

  const computed = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return safeEqual(computed, challenge);
}

/** Salted hash of a client IP, used only for registration rate limiting. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`, "utf8").digest("base64url");
}

/**
 * Exact redirect-URI match, with the loopback exception from RFC 8252 §7.3.
 *
 * Redirect URIs are matched exactly — no prefix or wildcard matching, which is
 * the classic way to turn an authorization server into an open redirector and
 * leak codes. The one carve-out is loopback addresses, where a native client
 * (Claude Code) binds an ephemeral port it cannot know at registration time:
 * for those, every component except the port must still match exactly.
 */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (safeEqual(registered, requested)) return true;

  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(requested);
  } catch {
    return false;
  }

  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (!loopbackHosts.has(a.hostname) || !loopbackHosts.has(b.hostname)) {
    return false;
  }

  return (
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search
  );
}

/**
 * Reject redirect targets that could be used to smuggle a code somewhere the
 * user did not intend. HTTPS everywhere, except loopback (native clients) —
 * and never javascript:/data: style schemes.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (parsed.hash) return false;

  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:" && loopbackHosts.has(parsed.hostname)) return true;

  return false;
}
