import { describe, it, expect, afterEach } from "vitest";
import { GET as appleAssociation } from "./.well-known/apple-app-site-association/route";
import { GET as assetLinks } from "./.well-known/assetlinks.json/route";

// These two files are what let a password manager treat a saved
// dodone.byebrianwong.com login as a match for the mobile app. Both are
// env-driven and 404 when unconfigured — a malformed association file is
// worse than a missing one, since both platforms cache it.

afterEach(() => {
  delete process.env.APPLE_APP_ID;
  delete process.env.ANDROID_CERT_FINGERPRINTS;
});

describe("/.well-known/apple-app-site-association", () => {
  it("404s when APPLE_APP_ID is unset", async () => {
    const res = await appleAssociation();
    expect(res.status).toBe(404);
  });

  it("serves the webcredentials app ID as JSON", async () => {
    process.env.APPLE_APP_ID = "ABCDE12345.com.beamer408.dodone";

    const res = await appleAssociation();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      webcredentials: { apps: ["ABCDE12345.com.beamer408.dodone"] },
    });
  });
});

describe("/.well-known/assetlinks.json", () => {
  it("404s when no signing fingerprints are configured", async () => {
    const res = await assetLinks();
    expect(res.status).toBe(404);
  });

  it("declares get_login_creds for every configured fingerprint", async () => {
    process.env.ANDROID_CERT_FINGERPRINTS = "AA:BB, CC:DD";

    const res = await assetLinks();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        relation: ["delegate_permission/common.get_login_creds"],
        target: {
          namespace: "android_app",
          package_name: "com.beamer408.dodone",
          sha256_cert_fingerprints: ["AA:BB", "CC:DD"],
        },
      },
    ]);
  });
});
