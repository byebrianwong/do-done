# Wear OS — device verification (open)

**Status: code written, never compiled, never run.**

There is no Android SDK, JDK, emulator, watch or phone on the development
machine. Everything in `apps/mobile/wear/` and
`apps/mobile/modules/dodone-wear/android/` is Kotlin that has never been through
a compiler, and the versions in `wear/build.gradle` have never been resolved
against a real repository. Treat the first build as a debugging session, not a
formality.

What CI *does* cover is the part that can be checked without a device:

| Covered | Where |
| --- | --- |
| The snapshot's shape, grouping, counts, caps and payload size | `apps/mobile/lib/wear-snapshot.test.ts` |
| Reading a write the watch sent, and building a task from dictated text | `apps/mobile/lib/wear-write.test.ts` |
| The sync's sequencing: a relayed write lands before the snapshot, syncs serialize, the payload carries no refresh token | `apps/mobile/lib/wear.test.ts` |
| The two copies of the Data Layer contract agreeing, the manifest naming classes that exist, the Gradle edits | `apps/mobile/plugins/withWearApp.test.ts` |

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

### 1. Does it build at all

```bash
cd apps/mobile
npx expo prebuild -p android --no-install
grep "include ':wear'" android/settings.gradle
grep compose-compiler android/build.gradle
cd android && ./gradlew :wear:assembleDebug
```

**Expect version failures here.** `wear/build.gradle` pins AndroidX versions that
were written from memory rather than resolved. If Gradle cannot find one, look up
the current release and correct it — that is the intended outcome of this step,
not a sign anything is wrong with the design.

Two other things that will bite:

- **`org.jetbrains.kotlin.plugin.compose` must be on the root classpath.**
  `withWearApp.js` adds it, anchored on the `classpath('com.android.tools.build:gradle')`
  line in Expo's generated `android/build.gradle`. If Expo ever changes that
  line the plugin silently leaves the file alone (there is a test asserting it
  does exactly that rather than mangling it), and the wear module then fails at
  configuration time with a message about an incompatible Compose plugin.
- **`minSdk 30`.** The phone app's minSdk is lower. The two modules do not have
  to agree.

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

## Known unknowns

Written down because each is a real risk, not a formality.

- **The AndroidX versions in `wear/build.gradle` are unverified.** See step 1.
- **`HeadlessJsTaskService` under the new architecture.** RN 0.81 with bridgeless
  resolves the host from `ReactApplication`; this relies on the default
  implementation doing that. `react-native-android-widget` uses the same
  mechanism in this app and works, which is the reason for the confidence, not a
  test.
- **Compose for Wear OS Material3 API surface.** `AppScaffold`, `ScreenScaffold`
  and the `Button` slots are written against 1.4.x. If the version moves, the
  signatures may not.
- **`RemoteInputIntentHelper` needs `androidx.wear:wear-input`.** If the picker
  never opens, that dependency is the first thing to check.
- **Wear OS delivery on Play.** The wear APK uses the same package name as the
  phone app and goes to the Wear OS track of the same listing. It has its own
  `versionCode` (currently `1`, hardcoded) and Play requires it to be distinct
  from the phone APK's in some configurations. That is a release-time problem
  and is not solved here.
- **`eas.json` has `wear-preview` and `wear-production` profiles**, which point
  Gradle at `:wear:assembleRelease` / `:wear:bundleRelease`. Neither has been
  run. The release build uses `signingConfigs.debug`, which is wrong for
  anything going to Play and right for anything going to a test watch.

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
