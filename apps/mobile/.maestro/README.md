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
- **Login fields are targeted by screen-% coordinates**, tuned for the `dodone`
  Pixel-7 AVD (1080×2400), because the `TextInput`s have no `testID`s and their
  placeholders aren't in the accessibility tree. This is the main fragility.
- **RN placeholders aren't reliably findable** by Maestro `tapOn: "<placeholder>"`.

## Recommended follow-up: add `testID`s

Adding `testID` props to the key inputs/rows would make these flows
resolution-independent and let us drop the coordinate taps entirely:

- `apps/mobile/app/(auth)/login.tsx` — email + password `TextInput`s, "Sign in" button
- `apps/mobile/components/QuickAddBar.tsx` — the task `TextInput` + submit button
- `apps/mobile/components/TaskItem.tsx` — the row container

Then flows can use `tapOn: { id: "login-email" }` etc.
