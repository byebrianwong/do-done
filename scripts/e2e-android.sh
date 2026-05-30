#!/usr/bin/env bash
#
# do-done Android end-to-end runner.
#
# Boots the emulator (if not already running), installs the dev-client APK
# (if not already installed), starts Metro, wires `adb reverse` so the dev
# client reaches it, launches the app pointed at Metro, then runs the Maestro
# flows in apps/mobile/.maestro/.
#
# One-time prerequisites — see apps/mobile/.maestro/README.md:
#   - Android SDK on PATH (adb, emulator) + an AVD named "dodone"
#   - Maestro CLI (~/.maestro/bin)
#   - a dev-client APK; export DEV_APK=/path/to/dev-client.apk
#       (download with: eas build:list --platform android  -> Application Archive URL)
#   - test credentials: export E2E_EMAIL=... E2E_PASSWORD=...
#
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -d "/opt/homebrew/share/android-commandlinetools" ] && ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_HOME
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$HOME/.maestro/bin:$PATH"

AVD="${AVD:-dodone}"
SERIAL="${SERIAL:-emulator-5554}"
APP_ID="com.beamer408.dodone"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
METRO_URL="http://localhost:8081"

: "${E2E_EMAIL:?Set E2E_EMAIL to a test-account email}"
: "${E2E_PASSWORD:?Set E2E_PASSWORD to the test-account password}"

# 1) Emulator -----------------------------------------------------------------
if ! adb devices | grep -q "^${SERIAL}\b"; then
  echo "==> Booting emulator '$AVD' (headless)..."
  emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -port 5554 \
    >/tmp/dodone-emulator.log 2>&1 &
  adb wait-for-device
  echo "==> Waiting for boot to complete..."
  until [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
fi
echo "==> Emulator ready: $SERIAL"

# 2) App ----------------------------------------------------------------------
if ! adb -s "$SERIAL" shell pm list packages | grep -q "$APP_ID"; then
  : "${DEV_APK:?App not installed; set DEV_APK to a dev-client APK path}"
  echo "==> Installing dev client: $DEV_APK"
  adb -s "$SERIAL" install -r "$DEV_APK"
fi

# 3) Metro --------------------------------------------------------------------
if ! curl -s -m 3 "$METRO_URL/status" | grep -q "packager-status:running"; then
  echo "==> Starting Metro..."
  (cd "$MOBILE" && npx expo start >/tmp/dodone-metro.log 2>&1 &)
  until curl -s -m 3 "$METRO_URL/status" | grep -q "packager-status:running"; do sleep 2; done
fi
echo "==> Metro ready at $METRO_URL"

# 4) Connect + launch ---------------------------------------------------------
adb -s "$SERIAL" reverse tcp:8081 tcp:8081
adb -s "$SERIAL" shell am force-stop "$APP_ID"
adb -s "$SERIAL" shell am start -a android.intent.action.VIEW \
  -d "dodone://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null

# 5) Run flows ----------------------------------------------------------------
echo "==> Running Maestro flows..."
maestro test -e EMAIL="$E2E_EMAIL" -e PASSWORD="$E2E_PASSWORD" "$MOBILE/.maestro/"
