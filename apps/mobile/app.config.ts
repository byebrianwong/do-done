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
  // Light, not "automatic", for the same reason the navigation theme is pinned
  // in app/_layout.tsx: no screen here has a dark palette. This is the native
  // half — the keyboard, native alerts and the status bar default — and unlike
  // the JS half it only takes effect on a fresh build.
  userInterfaceStyle: "light",
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
    // Links the app to the web login so iOS AutoFill / 1Password treat a saved
    // dodone.byebrianwong.com credential as a match for this app. The other
    // half is /.well-known/apple-app-site-association on the web app, which
    // needs APPLE_APP_ID set in the web deployment. EAS syncs the Associated
    // Domains capability onto the Apple app ID at build time.
    associatedDomains: ["webcredentials:dodone.byebrianwong.com"],
    infoPlist: {
      // Both prompts have to say that the recording is *kept*, not just heard:
      // a voice note is attached to the task alongside its transcript.
      NSMicrophoneUsageDescription:
        "Allow DoDone to record voice notes and attach them to your tasks.",
      NSSpeechRecognitionUsageDescription:
        "Allow DoDone to transcribe your voice notes into task titles and notes.",
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
      // Attaching a photo to a task. The picker itself is the only surface
      // that reaches for the library, and only when the user taps "Photo".
      "expo-image-picker",
      {
        photosPermission:
          "Allow DoDone to attach photos from your library to a task.",
        cameraPermission: "Allow DoDone to attach a photo you take to a task.",
      },
    ],
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
            // The tile itself, so the launcher's widget picker shows what you
            // actually get rather than the app icon.
            previewImage: "./assets/images/quick-add-preview.png",
            updatePeriodMillis: 0,
          },
          {
            name: "Today",
            label: "DoDone — Today",
            description: "Overdue + today's tasks",
            // Resizable: taller/wider shows more rows. targetCell* picks a
            // sensible default footprint on Android 12+.
            minWidth: "180dp",
            minHeight: "110dp",
            targetCellWidth: 3,
            targetCellHeight: 2,
            resizeMode: "horizontal|vertical",
            previewImage: "./assets/images/icon.png",
            updatePeriodMillis: 1800000,
          },
          {
            // A 4x1 strip for the row above the dock: one task, and the count
            // behind it. Resizable across, not down — a second line of cells
            // would just be a short Today widget.
            name: "NextUp",
            label: "DoDone — Next up",
            description: "The one task to do next",
            minWidth: "250dp",
            minHeight: "40dp",
            targetCellWidth: 4,
            targetCellHeight: 1,
            resizeMode: "horizontal",
            previewImage: "./assets/images/icon.png",
            updatePeriodMillis: 1800000,
          },
          {
            name: "Upcoming",
            label: "DoDone — Upcoming",
            description: "Tasks grouped by day",
            minWidth: "180dp",
            minHeight: "150dp",
            targetCellWidth: 3,
            targetCellHeight: 3,
            resizeMode: "horizontal|vertical",
            previewImage: "./assets/images/icon.png",
            updatePeriodMillis: 1800000,
          },
        ],
      },
    ],
    // Translucent QuickAddActivity for the 1x1 widget (floats over the home
    // screen). See plugins/withQuickAddActivity.js.
    "./plugins/withQuickAddActivity",
    // Launcher quick actions (Add task / Search / Today / Upcoming), each
    // pinnable to the home screen as a one-cell icon. See
    // plugins/withAndroidShortcuts.js.
    "./plugins/withAndroidShortcuts",
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
