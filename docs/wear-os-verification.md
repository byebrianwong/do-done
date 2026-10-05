# Wear OS — device verification (open)

**Status: compiles; never run on an emulator, a watch or a phone.**

The first build was done on 2026-10-05, in a Linux cloud session with the Android
SDK installed (platform 36, build-tools 36.0.0), from a clean
`expo prebuild -p android --clean`. With Expo 54's AGP 8.11 and Kotlin 2.1.20,
these all build:

```bash
./gradlew :wear:assembleDebug :wear:assembleRelease :wear:testDebugUnitTest \
  :dodone-wear:compileDebugKotlin :list-shortcuts:compileDebugKotlin \
  :app:compileDebugKotlin :app:processDebugMainManifest
```

The release APK keeps the tile, complication and listener classes through R8, and
is signed with the same certificate as the phone app's `debug.keystore`. The full
`:app:assembleDebug` (native code, NDK) was not run.

That build found four faults, all fixed in the same change:

| Fault | Fix |
| --- | --- |
| `androidx.wear.compose:compose-material3:1.4.1` does not exist. That library went from `1.0.0-alpha37` to `1.5.0`. | Wear Compose `1.5.6`, Tiles `1.5.0`, ProtoLayout `1.3.0`, Compose UI `1.9.5`: the same release era as AGP 8.11 and Kotlin 2.1.20. Newer AndroidX releases may need a newer Kotlin. |
| `withWearApp.js` wrote `'…compose-compiler-gradle-plugin:' + kotlinVersion`. Expo 54 sets `kotlinVersion` in the `expo-root-project` plugin, which is applied after the `buildscript` block, so the property was undefined. | Read it from the `expoLibs` version catalog instead, which is also where `expo-root-project` gets it. |
| `modules/dodone-wear/android/build.gradle` had no `versionName`, which `expo-module-gradle-plugin` requires, and no dependency on React Native, which `HeadlessJsTaskService` lives in. | Same shape as `modules/list-shortcuts`, plus `com.facebook.react:react-android`. |
| `MonochromaticImage.Builder` takes a platform `Icon`, not `IconCompat`. | `Icon.createWithResource`. |

What CI covers is the part that can be checked without an Android SDK:

| Covered | Where |
| --- | --- |
| The snapshot's shape, grouping, counts, caps and payload size | `apps/mobile/lib/wear-snapshot.test.ts` |
| Reading a write the watch sent, and building a task from dictated text | `apps/mobile/lib/wear-write.test.ts` |
| The sync's sequencing: a relayed write lands before the snapshot, syncs serialize, the payload carries no refresh token | `apps/mobile/lib/wear.test.ts` |
| The two copies of the Data Layer contract agreeing, the manifest naming classes that exist, the Gradle edits | `apps/mobile/plugins/withWearApp.test.ts` |
| The next-day view in the snapshot, and the payload staying under 75 KB with two days of full lists | `apps/mobile/lib/wear-snapshot.test.ts` |

The watch's own pure rules have JVM tests, which need the SDK and so run where the
watch app is built rather than in CI:

| Covered | Where |
| --- | --- |
| Which completion marks survive a snapshot (`keptCompletionMarks`) | `apps/mobile/wear/src/test/.../SnapshotLogicTest.kt` |
| Which day's view is true at a moment, and the timeline periods (`WearSnapshot.at`, `periodsFrom`) | same file |

None of that proves a single pixel.

---

## What shipped, so you know what "correct" looks like

Three surfaces, all reading one snapshot the phone pushes.

- **The watch app** — Today, Upcoming and Inbox, grouped the way the phone
  groups them. A row opens the task; the task screen has Done, Today, Tomorrow
  and Next week. An "Add a task" button opens Wear's input picker (voice,
  keyboard or handwriting).
- **One tile** — "TODAY": up to three tasks as chips, a summary line, and an Add
  chip.
- **Five complications** — today's progress as a ring, the count left today, the
  overdue count, the next task's title, and an add-a-task button.

### How data moves

```
phone: invalidateTasks() / foreground / watch asks
   → lib/wear.ts builds a snapshot from lib/wear-snapshot.ts
   → modules/dodone-wear puts two DataItems (/dodone/snapshot, /dodone/session)
watch: DataLayerListenerService stores them in SharedPreferences
   → app, tile and complications all read that cache, synchronously
```

Writes go the other way, and **which path a write takes is a rule, not a
fallback order** (see the comment on `WearWriter`):

| Write | Path |
| --- | --- |
| Complete, reschedule | the phone when it is reachable, Supabase directly when it is not |
| Create | the phone, always — queued when it is not reachable |

A create has to go through the phone because `parseTaskInput` is what turns
"call the bank tomorrow" into a task scheduled tomorrow, and it is TypeScript.

---

## Order to check things in

Each step's failure mode is silent, so do not skip ahead.

### 1. Does it build

```bash
cd apps/mobile
npx expo prebuild -p android --no-install
grep "include ':wear'" android/settings.gradle
grep compose-compiler android/build.gradle
cd android && ./gradlew :wear:assembleDebug :wear:testDebugUnitTest
```

This passed in the first build (see the top of this file). If it fails on a
newer Expo, two things are the likely cause:

- **`org.jetbrains.kotlin.plugin.compose` must be on the root classpath.**
  `withWearApp.js` adds it, anchored on the `classpath('com.android.tools.build:gradle')`
  line in Expo's generated `android/build.gradle`, with its version read from
  `expoLibs.versions.kotlin`. If Expo ever changes that line the plugin silently
  leaves the file alone (there is a test asserting it does exactly that rather
  than mangling it), and the wear module then fails at configuration time with
  a message about an incompatible Compose plugin.
- **The AndroidX versions are tied to the Kotlin version.** A newer AndroidX
  release can be compiled with a Kotlin the project's compiler cannot read.
  Move them together.

`minSdk 30` for the watch is deliberate. The phone app's minSdk is lower, and the
two modules do not have to agree.

### 2. Does the phone module compile into the phone app

```bash
cd android && ./gradlew :app:assembleDebug
```

The local Expo module in `modules/dodone-wear/` is autolinked. If it is not
picked up, check that `expo-module.config.json` is at the module root and names
`expo.modules.dodonewear.DoDoneWearModule`.

### 3. Does the snapshot arrive

Install the phone APK and the wear APK (`adb -s <watch> install`), sign in on the
phone, open the app.

- Phone → **Settings → App version → Watch** should read **Connected**. If it
  reads "Not connected", the capability never matched: check
  `wear/src/main/res/values/wear.xml` against
  `WearContract.CAPABILITY_WATCH_APP`, and confirm both APKs carry the same
  `applicationId` and are signed with the same key. Play pairs them by package
  name, and the Data Layer only connects nodes that share one.
- Open the watch app. It should show today's tasks and "Updated just now".

**"Updated" never changing is the tell for everything upstream of the watch.**
It is the one number on the screen that comes from the phone rather than from
disk.

### 4. Does the tile draw

Long-press the watch face → Tiles → add DoDone. Then complete a task on the
phone and watch the tile change without opening anything.

If the tile is missing from the picker entirely, R8 stripped it: nothing in the
module references `TodayTileService` by name. `proguard-rules.pro` keeps it, so
check that file survived the copy into `android/wear`.

### 5. Do the complications draw

Edit a watch face, pick a slot, look for DoDone. There should be **five separate
entries**, not one.

The overdue complication is deliberately absent when nothing is overdue, so test
it with a task dated yesterday.

### 6. Does a write land

- Complete a task on the watch with the phone nearby. The row should go
  immediately; the phone's list should follow within a second or two.
- Complete one with the phone switched off. The row should still go. Turn the
  phone on: the completion should land, and the snapshot that comes back should
  keep the row gone.
- Add a task by voice. Say "call the bank tomorrow" — it must arrive on the
  phone **scheduled for tomorrow**, titled "call the bank". If it arrives titled
  "call the bank tomorrow" and undated, the relay path is broken and something
  parsed it on the watch, which nothing there should be doing.

### 6a. Does a tick that never landed come back

Force-stop DoDone on the phone (Settings → Apps → DoDone → Force stop). A
force-stopped app is not woken for Data Layer messages, so the relay reaches the
phone and is never applied. Tick a task on the watch: the row goes. Wait more
than two minutes, then open DoDone on the phone. The snapshot it sends still
lists the task, so the row should come back on the watch.

If it stays hidden, the local mark outlived its write: check `keptCompletionMarks`
and `LANDING_GRACE_MS` in `SnapshotStore.kt`.

### 7. Does the token survive the phone sleeping

The hardest one, and the reason `WearSyncRequestService` exists. Leave the phone
untouched for over an hour (screen off, app not opened), then complete a task on
the watch.

- The watch's access token is expired by then, so `WearWriter.direct` declines
  without sending.
- The relay should still work: the message wakes `WearSyncRequestService`, which
  starts a headless JS task, which refreshes the session and applies the write.

**If this fails, the likely cause is the background service start.**
`startService` from a `WearableListenerService` is legal only inside the
platform's temporary allowlist. The code catches `IllegalStateException` and
gives up quietly, so the symptom is a completion that lands the next time the
phone is opened rather than immediately. Check logcat for the headless task
starting at all.

---

### 8. Does the tile change at midnight

The hard one to wait for, so move the clock instead. On the watch, turn off
automatic date and time and set it to 23:58. Look at the tile and a progress
complication, then wait for 00:00 without opening anything.

- The tile should show the next day: yesterday's unfinished tasks under the
  overdue count in its summary, and today's tasks in its rows.
- The progress complication should drop to 0 done.
- Within a few seconds, if the phone is in range, a fresh snapshot should
  arrive, because the tile and the complications ask for one once they are
  drawn with anything but today's view.

Then set the date two days ahead. The tile should read "Out of date. Open
DoDone on your phone", and the reading complications should go empty. Put the
clock back to automatic afterwards; a wrong clock breaks the Data Layer's view
of what is new.

Also check the overdue complication empties when the last overdue task is
ticked off. It used to keep its old number, because a null answer means "keep
the previous data".

## Known unknowns

Written down because each is a real risk, not a formality.

- **Timelines on real watch faces.** The tile and the complications hand the
  system up to three timeline entries. The library accepts them (it validates
  each on the way out), but whether every watch face honours a complication
  timeline is not something a compiler can say. Step 8 is the check.
- **`HeadlessJsTaskService` under the new architecture.** RN 0.81 with bridgeless
  resolves the host from `ReactApplication`; this relies on the default
  implementation doing that. `react-native-android-widget` uses the same
  mechanism in this app and works, which is the reason for the confidence, not a
  test.
- **`RemoteInputIntentHelper` opening the picker.** It compiles against
  `androidx.wear:wear-input:1.1.0`. Whether the picker opens on a given watch is
  a runtime question.
- **Wear OS delivery on Play.** The wear APK uses the same package name as the
  phone app and goes to the Wear OS track of the same listing. It has its own
  `versionCode` (currently `1`, hardcoded) and Play requires it to be distinct
  from the phone APK's in some configurations. That is a release-time problem
  and is not solved here.
- **`eas.json` has `wear-preview` and `wear-production` profiles**, which point
  Gradle at `:wear:assembleRelease` / `:wear:bundleRelease` and EAS at
  `android/wear/build/outputs` for the result. Neither has been run.
- **Signing.** The watch must be signed with the phone app's key, or the Data
  Layer never connects them. Locally, `wear/build.gradle` signs with
  `android/app/debug.keystore`, the same file the phone app's debug build uses.
  On EAS it applies `android/app/eas-build-inject-android-credentials.gradle`,
  the script EAS writes for the phone app, because EAS does not apply it to any
  other module. That script has never been run from the wear module. If an EAS
  watch build reads "Not connected", compare the two APKs' certificates with
  `apksigner verify --print-certs` before looking anywhere else.

## What the watch deliberately does not do

Not gaps to fill later — decisions, with reasons, in case one looks like an
oversight:

- **No editor.** Notes, subtasks, attachments, projects, deadlines and
  recurrence are all real and all unreachable from the watch. A watch screen
  cannot show them and a watch keyboard cannot fix them.
- **No shopping lists.** `is_list_item` tasks are filtered out of the snapshot
  entirely. A list is walked with a phone in your hand.
- **No completion animation.** The 680ms envelope in `@do-done/shared` is a
  phone gesture; on a watch the screen is off two seconds after the tap.
- **No Phosphor icons.** A project with one gets a bare coloured ring, which is
  already a first-class state. Drawing them would mean porting ~697 KB of path
  data into the watch APK.
- **No pet.** A completion made directly by the watch (phone out of range) does
  not feed it. Relayed completions do, because they go through `TasksApi`.
