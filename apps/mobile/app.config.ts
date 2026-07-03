import type { ExpoConfig, ConfigContext } from "expo/config";
import { execSync } from "child_process";

function gitInfo() {
  try {
    return {
      branch: execSync("git rev-parse --abbrev-ref HEAD")
        .toString()
        .trim(),
      sha: execSync("git rev-parse --short HEAD").toString().trim(),
    };
  } catch {
    return { branch: "unknown", sha: "unknown" };
  }
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "DoDone",
  slug: "do-done",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "dodone",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  runtimeVersion: {
    policy: "appVersion",
  },
  updates: {
    url: "https://u.expo.dev/e987bcc6-0e98-4b76-960c-40756e452fef",
  },
  splash: {
    image: "./assets/images/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#6366f1",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.beamer408.dodone",
    infoPlist: {
      NSMicrophoneUsageDescription:
        "Allow DoDone to use the microphone for voice task entry.",
      NSSpeechRecognitionUsageDescription:
        "Allow DoDone to recognize speech for voice task entry.",
      NSLocationWhenInUseUsageDescription:
        "Allow DoDone to remind you of tasks based on your location.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Allow DoDone to remind you of location-based tasks even when the app is in the background.",
    },
  },
  android: {
    package: "com.beamer408.dodone",
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#6366f1",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    permissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-speech-recognition",
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission:
          "Allow DoDone to remind you of location-based tasks.",
        isAndroidBackgroundLocationEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    [
      "react-native-android-widget",
      {
        widgets: [
          {
            name: "QuickAdd",
            label: "DoDone — Quick Add",
            description: "Tap to quickly add a task",
            // 1x1 square (≈ one launcher cell), fixed size like Todoist's
            // add-task widget. targetCell* pins it to 1x1 on Android 12+.
            minWidth: "40dp",
            minHeight: "40dp",
            targetCellWidth: 1,
            targetCellHeight: 1,
            resizeMode: "none",
            previewImage: "./assets/images/icon.png",
            updatePeriodMillis: 0,
          },
          {
            name: "Today",
            label: "DoDone — Today",
            description: "Today's focus tasks",
            minWidth: "250dp",
            minHeight: "180dp",
            previewImage: "./assets/images/icon.png",
            updatePeriodMillis: 1800000,
          },
        ],
      },
    ],
    // Translucent QuickAddActivity for the 1x1 widget (floats over the home
    // screen). See plugins/withQuickAddActivity.js.
    "./plugins/withQuickAddActivity",
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: "e987bcc6-0e98-4b76-960c-40756e452fef",
    },
    git: gitInfo(),
    // Deployed DoDone web app — the mobile app calls its /api/calendar/events
    // route to show Google Calendar events. EXPO_PUBLIC_WEB_APP_URL overrides
    // at runtime; leaving both unset just hides calendar events on mobile.
    webAppUrl: process.env.EXPO_PUBLIC_WEB_APP_URL ?? null,
  },
});
