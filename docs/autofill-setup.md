# Password-manager autofill — remaining setup

**Status: code is shipped, configuration is not.** PR #159 (merged `763e361`,
2026-07-31) fixed autofill on both login screens and added the app↔site
association plumbing. Three follow-up steps are needed to finish it, all of
them config/build work outside the repo.

Background on the mechanisms is in the "Password-manager autofill" section of
[`CLAUDE.md`](../CLAUDE.md). This doc is the checklist.

---

## What already works

Autofill itself — 1Password offering to fill email + password — works from the
merged code alone, on both surfaces, with no further setup:

- `apps/mobile/app/(auth)/login.tsx` — `autoComplete` (→ Android
  `autofillHints`), `textContentType` (→ iOS AutoFill), `importantForAutofill`.
- `apps/web/src/app/(auth)/login/page.tsx` — `name` + `autocomplete`.

The mobile JS change already shipped over EAS Update to the `preview` channel,
so installed preview builds have it.

## What's left

Everything below is about **credential matching** — making a saved
`dodone.byebrianwong.com` login match the *app*, instead of the app being a
separate vault item. Nothing here is required for the fill prompt to appear.

### [ ] 1. Set `ANDROID_CERT_FINGERPRINTS` in the Vercel deployment

Feeds `/.well-known/assetlinks.json`, which Android's Autofill Framework (and
1Password on top of it) reads to decide whether the site's credentials apply to
the app. **The route 404s while this is unset.**

Value: comma-separated SHA-256 signing-certificate fingerprints, 32
colon-separated uppercase hex bytes each.

Android checks the fingerprint of whichever key signed the *installed* APK, so
which one(s) you need depends on distribution:

| Distribution | Signing key | Where to find it |
|---|---|---|
| Sideloaded `development` / `preview` APK | EAS upload key | `cd apps/mobile && eas credentials -p android` → pick profile → Keystore → `SHA256 Fingerprint` |
| Google Play (with Play App Signing) | Google's app-signing key | Play Console → Test and release → App integrity → App signing → "App signing key certificate" |

Not on Play yet ⇒ the EAS one alone is enough. Add the Play one when you
publish, or store installs silently stop matching. Listing extra fingerprints
is harmless.

Ground truth if either value looks wrong — read it off the APK you actually
installed:

```bash
keytool -printcert -jarfile your-preview-build.apk | grep SHA256
```

```
ANDROID_CERT_FINGERPRINTS=3A:F1:...:9C,B7:0D:...:44
```

Verify: `curl https://dodone.byebrianwong.com/.well-known/assetlinks.json`
— a 404 means the var didn't reach the deployment.

### [ ] 2. Set `APPLE_APP_ID` in the Vercel deployment

Feeds `/.well-known/apple-app-site-association`. Same deal — **404s while
unset**.

Value: `<AppleTeamID>.com.beamer408.dodone`. Team ID from
https://developer.apple.com/account → Membership details.

```
APPLE_APP_ID=ABCDE12345.com.beamer408.dodone
```

Verify: `curl https://dodone.byebrianwong.com/.well-known/apple-app-site-association`
— must come back `200` with `content-type: application/json` and **no
redirect**. Apple's spec forbids a redirect here; `/.well-known` is already in
`PUBLIC_PATHS` in `proxy-helper.ts` to prevent the auth proxy 307ing it.

Only needed if/when the app ships on iOS — it's inert for an Android-only
install base.

### [ ] 3. Run a fresh `eas build` for the iOS association

`ios.associatedDomains: ["webcredentials:dodone.byebrianwong.com"]` was added to
`apps/mobile/app.config.ts`, but it's **native config baked into the app's
entitlements at build time** — an OTA update can't apply it. It needs
`eas build`, which is also where EAS syncs the Associated Domains capability
onto the Apple app ID.

Android needs no app-side rebuild for association: `assetlinks.json` is checked
against the installed signature at fill time, so step 1 takes effect on its own.

---

## Testing it end to end

1. Build and install a **preview or release** build — `expo-dev-client`
   intercepts launches in debug builds, so a development build won't exercise
   the real flow.
2. Android: Settings → Passwords & accounts → Autofill service → **1Password**.
3. Open the DoDone login screen and tap the email field. Expect 1Password's
   inline suggestion above the keyboard.
4. With steps 1–3 above done, the suggested item should be the existing
   `dodone.byebrianwong.com` login rather than a "no matching items" prompt.

## Troubleshooting

- **No prompt at all** — the autofill hints aren't reaching the OS. Confirm the
  build actually includes the merged `login.tsx` (check EAS Update picked it up,
  or rebuild), and that 1Password is the selected autofill service.
- **Prompt appears but no matching item** — that's the association half, i.e.
  steps 1–3 here. Check the `.well-known` URLs return 200.
- **Association files return 404** — the env var is unset in that Vercel
  environment. Both routes deliberately 404 rather than serve a placeholder,
  because Apple and Google cache association files and a malformed one is worse
  than a missing one.
- **Changed a fingerprint and nothing happened** — both platforms cache. On
  Android, clearing Google Play Services storage or reinstalling the app forces
  a re-fetch.

Route implementations and their tests:

- `apps/web/src/app/.well-known/assetlinks.json/route.ts`
- `apps/web/src/app/.well-known/apple-app-site-association/route.ts`
- `apps/web/src/app/well-known.test.ts`
