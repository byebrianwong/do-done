# Mobile end-to-end tests (Maestro)

Automated UI tests that drive the **real app on an Android emulator** and capture
screenshots — so UI/gesture regressions get caught without manual on-device
testing. ([Maestro](https://maestro.mobile.dev) is the runner; flows are the
`.yaml` files in this folder.)

## One-time setup (macOS, Apple Silicon)

```bash
# JDK + Android SDK command-line tools
brew install openjdk@17
brew install --cask android-commandlinetools
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# platform-tools (adb), emulator, an arm64 system image
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "emulator" \
  "platforms;android-34" "system-images;android-34;google_apis;arm64-v8a"

# the "dodone" AVD
echo no | avdmanager create avd -n dodone -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_7

# Maestro
curl -fsSL "https://get.maestro.mobile.dev" | bash
```

You also need a **dev-client APK** (the native shell — JS is served by Metro):

```bash
eas build:list --platform android   # copy the "Application Archive URL"
curl -L -o /tmp/dodone-dev.apk "<that-url>"
export DEV_APK=/tmp/dodone-dev.apk
```

## Running

```bash
export E2E_EMAIL="<test-account-email>"
export E2E_PASSWORD="<test-account-password>"
export DEV_APK=/tmp/dodone-dev.apk     # only needed on first install
scripts/e2e-android.sh
```

The runner boots the emulator, installs the app, starts Metro, connects, launches
the app, and runs every flow in this folder. Screenshots land in
`~/.maestro/tests/<timestamp>/`.

**Credentials** come from env vars (`E2E_EMAIL` / `E2E_PASSWORD`) — never commit
them. In CI, store them as repository secrets. Use a dedicated test account.

## Known gotchas (learned the hard way)

- **Gesture dismissal (swipe-down) doesn't trigger via Maestro's `swipe`.** The
  task sheet's drag-to-dismiss is a `react-native-gesture-handler` Pan; Maestro's
  synthetic swipe doesn't drive it. Use a raw touch swipe instead:
  `adb shell input swipe 540 420 540 1950 500`. (Tapping the ×, the backdrop, or
  the back button all dismiss it normally and are Maestro-friendly.)
- **RN placeholders aren't reliably findable** by Maestro `tapOn: "<placeholder>"` —
  which is why the login and quick-add inputs are targeted by `testID`
  (`login-email`, `login-password`, `login-submit`, `quick-add-button`,
  `quick-add-input`, `quick-add-submit`) rather than placeholder text or screen
  coordinates.

## testIDs

The login screen and quick-add expose `testID`s so flows are
resolution-independent. Capture is two steps now — the plus button opens the
composer, and the composer holds the input:

- `components/LoginScreen.tsx` — `login-email`, `login-password`, `login-submit`
- `components/QuickAddButton.tsx` — `quick-add-button`
- `components/QuickAddComposer.tsx` — `quick-add-input`, `quick-add-submit`,
  `quick-add-mic`

Task rows are matched by title text. To target a specific row deterministically,
add `testID={\`task-${task.id}\`}` to the row `Pressable` in `components/TaskItem.tsx`.
