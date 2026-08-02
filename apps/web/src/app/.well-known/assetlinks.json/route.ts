/**
 * Digital Asset Links — the Android half of app↔site credential linking.
 *
 * `common.get_login_creds` is the permission Android's Autofill Framework (and
 * 1Password on top of it) checks before offering a dodone.byebrianwong.com
 * login inside the DoDone app. Without it the app and the site are separate
 * items in the vault.
 *
 * Configured via ANDROID_CERT_FINGERPRINTS: a comma-separated list of SHA-256
 * signing-certificate fingerprints. You normally need **two** — the upload key
 * EAS signs with and the key Google Play re-signs with:
 *
 *   eas credentials -p android          # upload key fingerprint
 *   Play Console → Release → Setup → App signing   # app signing key
 *
 * Unset ⇒ 404, so we never publish an assetlinks file that claims a key we
 * can't back.
 */
const PACKAGE_NAME = "com.beamer408.dodone";

export const dynamic = "force-dynamic";

export async function GET() {
  const fingerprints = (process.env.ANDROID_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  if (fingerprints.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  return Response.json(
    [
      {
        relation: ["delegate_permission/common.get_login_creds"],
        target: {
          namespace: "android_app",
          package_name: PACKAGE_NAME,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=3600",
      },
    }
  );
}
