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
3. **Placed widget** renders the badged tile — and check it **with the app force-
   stopped** (Settings → Apps → DoDone → Force stop, then add the widget; better
   still, reboot the phone and watch it redraw). That is the case that was broken:
   the tile drew whenever the app was warm and was invisible when it wasn't, so a
   check done straight after opening the app proves nothing. If the picker
   thumbnail is right but the placed tile is blank, and it's blank warm *and*
   cold, that's a `SvgWidget` rendering problem — see the fallback below.
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
8. **The in-app path** — `dodone://quick-add`, which is also where the plus
   button on every list screen lands — shares the same composer, so re-check
   4-7 there.

---

## Fixed since: the tile was invisible whenever the app was closed

Reported after PR #157, and the cause predates it — it was there from the day the
widget shipped, it just needed the app to be cold to show.

`registerWidgetTaskHandler` is `AppRegistry.registerHeadlessTask`. It was called
from `app/_layout.tsx`, at that module's top level. Expo Router loads route
modules through `require.context`, and Metro compiles a context module to a map
of **lazy getters** — `_layout.tsx` is `require`d when the router renders it, not
when the bundle is evaluated. Meanwhile the launcher's widget update arrives
through `RNWidgetBackgroundTaskWorker`, which calls `reactHost.start()` when
there's no live context: the bundle runs with no activity and no React tree. So
the task key was unregistered, the render never happened, and the widget kept the
empty `initialLayout` it was born with. On a home screen that isn't an error
state, it's an invisible tile.

It drew fine whenever the app happened to be running or recently killed (warm
ReactContext, `_layout` already evaluated), which is exactly why it read as
intermittent, and as "fixed" right after every install-and-open.

Three changes, in order of how much they matter:

1. **Registration moved to `index.js`**, the bundle entry — the only place that
   runs in every JS context: MainActivity, QuickAddActivity, and the headless
   widget task. This is the actual fix, and it fixes the Today and Upcoming
   widgets too.
2. **The tile paints its own background.** `SvgWidget` catches a parse failure
   with `printStackTrace` and draws nothing, and the tile had no background
   behind it, so that path also ended in a transparent widget. There's now a flat
   indigo squircle under the SVG, sized to a centred `min(width, height)` square.
3. **Fewer ways to skip the draw.** The handler renders for every action but
   `WIDGET_DELETED` (it used to ignore `WIDGET_RESIZED`), the data layer is
   `await import`ed so a Supabase failure can't stop the static tile loading, and
   `repaintQuickAddWidget()` runs once per app launch so a lost render heals.

`widgets/widget-task-handler.test.ts` covers what's coverable in node: which
actions draw, that the tile carries a painted background, and that it draws with
`@/lib/supabase` unimportable. Nothing in CI can prove the registration is early
enough — that needs step 3 below, on a device, with the app force-stopped.

---

## Launcher quick actions (app shortcuts)

Separate mechanism, same "never seen on a device" status. `plugins/withAndroidShortcuts.js`
declares four static shortcuts — Add task, Search, Today, Upcoming — in
`res/xml/shortcuts.xml`, pointed at from a `meta-data` tag on MainActivity.
They are drawn by the *launcher*, not by us, so a pinned one occupies exactly
one cell and lines up with the app icons around it. That is the entire reason
they exist rather than a second 1×1 widget.

1. **Long-press the DoDone icon.** Four rows appear under "Widgets": Add task,
   Search, Today, Upcoming, each with its glyph on an indigo circle. A row
   showing a generic icon means the drawable didn't resolve; a *missing* row
   means Android dropped that `<shortcut>` — almost always a label that isn't a
   `@string/` reference, which it discards without logging.
2. **Tap each row.** Search / Today / Upcoming open MainActivity on that screen;
   the URI is delivered as the intent's data, so this exercises the same
   expo-linking path the widgets use. Add task floats the translucent composer
   over the home screen without launching the app — identical to tapping the 1×1
   widget, because it targets the same `QuickAddActivity`.
3. **Pin one** with the "+" on its right. It lands on the home screen as a plain
   icon, app-icon-sized, with a small DoDone badge in the corner (the launcher
   adds that — it isn't ours and can't be turned off).
4. **Compare it against a neighbouring app icon.** Same cell, same mask shape.
   If the shortcut is a circle sitting inside a squircle app icon, the launcher
   ignored the adaptive icon in `drawable-anydpi-v26` and fell back to the
   plain `drawable/` vector — which is the intended API 24-25 behavior but
   wrong on anything newer.

Step 4 is the one that can't be checked anywhere but a device: the mask comes
from the launcher's own config, so Pixel Launcher, One UI and Nova will each
answer it differently.

---

## If the tile renders blank or wrong (step 3 fails)

`SvgWidget` takes a raw SVG string and renders it through AndroidSVG; the library
bundles `com.caverock:androidsvg-aar` and registers the widget in
`WidgetFactory.java`, so the path exists — but it is the least-used one in
that library. The fallback is `ImageWidget`, which is far more widely used:

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
