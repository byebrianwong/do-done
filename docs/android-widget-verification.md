# Android quick-add widget — device verification (open)

**Status: code shipped, never confirmed on a physical device.**

PR #154 (`922e2d3`, 2026-07-29) reworked the 1×1 Quick Add widget and the composer
it opens. PR #161 (`4eba3fe`) then extracted the chips and their popovers into
`apps/mobile/components/QuickAddFields.tsx`, leaving the keyboard lift in
`QuickAddComposer.tsx`; both hosts (`quick-add-root.tsx` for the widget,
`app/quick-add.tsx` for the in-app modal) render the composer.

Everything typechecks, and the tile artwork was validated by rendering the SVG in
a headless browser — but **no build carrying these changes has ever been seen
running on a phone.** Three install attempts all ran an APK built from a stale
checkout, which looks exactly like a failed fix. Read "Build gotchas" before
concluding anything is broken.

---

## What shipped, so you know what "correct" looks like

- **The tile** — `widgets/QuickAddWidget.tsx` renders one inline SVG from
  `widgets/dodone-mark.ts` through `SvgWidget`: the DoDone mark on an indigo
  gradient squircle with a white "+" badge in the bottom-right corner. **No text
  anywhere on it.** It replaced `IconWidget`, which draws the icon *name* as text
  in a typeface the app must ship — with no `material.ttf` in `assets/fonts`,
  `icon="add"` literally painted the word "add" on the home screen. The Today
  widget's header icon had the same bug and the same fix.
- **The composer's position** — `QuickAddActivity` is pinned to
  `windowSoftInputMode="adjustResize"` (in `plugins/withQuickAddActivity.js`), and
  the card rides the IME via Reanimated's `useAnimatedKeyboard`. Before, the
  activity had no soft-input mode, so the platform panned the whole window up
  while the composer separately offset itself by a `keyboardDidShow` measurement —
  two lifts fighting, which is what "jumps all over the place" was.
- **The chips** — Date / Priority / Estimate open inline popovers anchored above
  the chip that opened them, in the same window, so the keyboard stays up. They
  used to be `Modal`s, which on Android open a new window, drop the IME, and
  collapse the card. Only the full month grid is still a `Modal`; it hands focus
  back to the input on close.

---

## Verification checklist

Each step gates the next — a failure at step 1 or 2 means the APK is wrong, not
the code.

1. **Settings → Version** shows the short sha of the commit you built from, and
   "Last updated" shows the build time. If the sha isn't what `git log -1` says in
   the tree you built from, stop: you're running a different build. This is the
   fastest signal there is, and it does not require touching the home screen.
2. **Widget picker thumbnail** (long-press home → Widgets → DoDone). "DoDone —
   Quick Add" should show the tile *with the "+" badge*. This is
   `assets/images/quick-add-preview.png` compiled into `res/drawable`, so it
   proves the APK's contents with no JS involved. If it still shows the plain app
   icon, the APK predates PR #154. ("DoDone — Today" legitimately still previews
   `icon.png`.)
3. **Placed widget** renders the badged tile. If the picker thumbnail is right but
   the placed tile is blank or wrong, that's a `SvgWidget` rendering problem — see
   the fallback below.
4. **Tap it.** The composer opens above the keyboard, on the first frame, and
   stays put. Nothing should slide or settle after the keyboard lands.
5. **Tap Date, Priority, Estimate.** Each opens a popover directly above its chip;
   the keyboard stays up and the card does not move. The Estimate popover should
   clamp to the card's right edge rather than overflowing.
6. **Date → "Pick a date…"** opens the month grid (the keyboard drops here — it's
   a `Modal`, and that's intended); picking a day or dismissing returns focus to
   the input and brings the keyboard back.
7. **Back** with a popover open closes only the popover; a second back dismisses
   the whole surface to the launcher.
8. **The in-app path** — `dodone://quick-add`, and the quick-add bar in the app —
   shares the same composer, so re-check 4-7 there.

---

## If the tile renders blank or wrong (step 3 fails)

`SvgWidget` takes a raw SVG string and renders it through AndroidSVG; the library
bundles `com.caverock:androidsvg-aar` and registers the widget in
`WidgetFactory.java`, so the path exists — but it's the least-travelled one in
that library. The fallback is `ImageWidget`, which is the well-worn path:

- Rasterize the same SVG to a PNG (that's how `assets/images/quick-add-preview.png`
  was produced — headless Chromium screenshot of `quickAddTileSvg()` at 240×240
  with `omitBackground`, so the rounded corners stay transparent).
- `ImageWidget` needs explicit `imageWidth` / `imageHeight` in dp rather than
  `match_parent`. `widgetTaskHandler` receives `props.widgetInfo.width` and
  `.height`, so pass those into `QuickAddWidget` and size the image from them
  instead of hardcoding.

---

## Build gotchas

These have each already cost a full build-and-install cycle.

1. **Stale checkout.** `eas build` archives the working tree of the directory you
   run it in. A build kicked off minutes after a merge, before pulling, produces an
   APK at the *old* commit — and the result is indistinguishable from "the fix
   didn't work". `app.config.ts` bakes `git rev-parse --short HEAD` into
   `extra.git.sha`, which surfaces in Settings → Version, so always confirm
   `git log -1 --oneline` before building and the sha in Settings after installing.
2. **Signing.** The `development` profile builds with `:app:assembleDebug` (debug
   keystore); `preview` and `production` use the EAS release keystore. Android
   refuses to install over an APK signed with a different key, and the failure is
   quiet — uninstall the app first when switching profiles.
3. **The launcher caches widget renders.** `updatePeriodMillis: 0` on QuickAdd
   means it only re-renders on add/resize, so remove and re-add the widget after
   installing or you'll keep looking at the old art.
4. **Use a `preview` build, not `development`.** `expo-dev-client` intercepts the
   `dodoneadd://` launch in debug builds, so the widget tap flow can't be tested
   there at all.
5. **Don't publish an OTA update from this code to old installs.**
   `runtimeVersion` is `appVersion` and the version is still `1.0.0`, so an
   `eas update` also reaches installs that lack the `adjustResize` manifest entry.
   Those would get the new composer JS with the old window-panning behavior — worse
   than either half alone. Bump the version, or wait until everyone's rebuilt.
