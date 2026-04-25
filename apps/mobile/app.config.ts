import type { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "do-done",
  slug: "do-done",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "dodone",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  splash: {
    image: "./assets/images/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.beamer408.dodone",
    infoPlist: {
      NSMicrophoneUsageDescription:
        "Allow do-done to use the microphone for voice task entry.",
      NSSpeechRecognitionUsageDescription:
        "Allow do-done to recognize speech for voice task entry.",
      NSLocationWhenInUseUsageDescription:
        "Allow do-done to remind you of tasks based on your location.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Allow do-done to remind you of location-based tasks even when the app is in the background.",
    },
  },
  android: {
    package: "com.beamer408.dodone",
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#ffffff",
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
          "Allow do-done to remind you of location-based tasks.",
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
            label: "do-done — Quick Add",
            description: "Tap to quickly add a task",
            minWidth: "180dp",
            minHeight: "60dp",
            previewImage: "./assets/images/icon.png",
            updatePeriodMillis: 0,
          },
          {
            name: "Today",
            label: "do-done — Today",
            description: "Today's focus tasks",
            minWidth: "250dp",
            minHeight: "180dp",
            previewImage: "./assets/images/icon.png",
            updatePeriodMillis: 1800000,
          },
        ],
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: "REPLACE_WITH_EAS_PROJECT_ID",
    },
  },
});
