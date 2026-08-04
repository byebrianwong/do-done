import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateToken,
  hashToken,
  isAllowedRedirectUri,
  redirectUriMatches,
  safeEqual,
  verifyPkceS256,
} from "./crypto";

/** Build a valid PKCE pair the way a spec-compliant client would. */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

describe("verifyPkceS256", () => {
  it("accepts a correctly derived verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("rejects a verifier that does not derive the challenge", () => {
    const { challenge } = pkcePair();
    const { verifier: other } = pkcePair();
    expect(verifyPkceS256(other, challenge)).toBe(false);
  });

  it("rejects a plain (unhashed) verifier echoed as the challenge", () => {
    // The 'plain' method is removed in OAuth 2.1; accepting it here would let
    // anyone holding an intercepted code redeem it.
    const { verifier } = pkcePair();
    expect(verifyPkceS256(verifier, verifier)).toBe(false);
  });

  it("rejects verifiers outside the RFC 7636 length bounds", () => {
    const short = "a".repeat(42);
    const long = "a".repeat(129);
    expect(verifyPkceS256(short, createHash("sha256").update(short).digest("base64url"))).toBe(false);
    expect(verifyPkceS256(long, createHash("sha256").update(long).digest("base64url"))).toBe(false);
  });

  it("rejects verifiers containing characters outside the unreserved set", () => {
    const bad = `${"a".repeat(42)}/`;
    expect(verifyPkceS256(bad, createHash("sha256").update(bad).digest("base64url"))).toBe(false);
  });
});

describe("safeEqual", () => {
  it("matches identical strings and rejects differing ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("returns false rather than throwing on length mismatch", () => {
    expect(safeEqual("short", "a-much-longer-value")).toBe(false);
  });
});

describe("hashToken", () => {
  it("is stable and does not return the input", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
  });

  it("separates distinct tokens", () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });
});

describe("redirectUriMatches", () => {
  it("matches exactly", () => {
    const uri = "https://claude.ai/api/mcp/auth_callback";
    expect(redirectUriMatches(uri, uri)).toBe(true);
  });

  it("rejects a different path on the same host", () => {
    expect(
      redirectUriMatches("https://claude.ai/api/mcp/auth_callback", "https://claude.ai/evil")
    ).toBe(false);
  });

  it("rejects a prefix-extended URI", () => {
    // Prefix matching is the classic open-redirect bug; this must not pass.
    expect(
      redirectUriMatches(
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.ai/api/mcp/auth_callback.evil.com"
      )
    ).toBe(false);
  });

  it("rejects a different host", () => {
    expect(
      redirectUriMatches("https://claude.ai/cb", "https://claude.ai.evil.com/cb")
    ).toBe(false);
  });

  it("allows any port on loopback, per RFC 8252", () => {
    expect(
      redirectUriMatches("http://127.0.0.1/callback", "http://127.0.0.1:52341/callback")
    ).toBe(true);
    expect(
      redirectUriMatches("http://localhost/callback", "http://localhost:9999/callback")
    ).toBe(true);
  });

  it("does not extend the port exception to non-loopback hosts", () => {
    expect(
      redirectUriMatches("https://claude.ai/cb", "https://claude.ai:8443/cb")
    ).toBe(false);
  });

  it("still requires the path to match on loopback", () => {
    expect(
      redirectUriMatches("http://127.0.0.1/callback", "http://127.0.0.1:5000/evil")
    ).toBe(false);
  });
});

describe("isAllowedRedirectUri", () => {
  it("allows https", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
  });

  it("allows http only on loopback", () => {
    expect(isAllowedRedirectUri("http://127.0.0.1:1410/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:1410/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://example.com/callback")).toBe(false);
  });

  it("rejects dangerous schemes", () => {
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,<script>")).toBe(false);
    expect(isAllowedRedirectUri("file:///etc/passwd")).toBe(false);
  });

  it("rejects fragments and unparseable values", () => {
    expect(isAllowedRedirectUri("https://claude.ai/cb#fragment")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });
});
