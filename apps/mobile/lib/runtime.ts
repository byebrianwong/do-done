import Constants from 'expo-constants';

/**
 * `true` when the app is running inside the Expo Go sandbox client, which
 * doesn't include arbitrary native modules (no expo-speech-recognition, no
 * expo-notifications since SDK 53, no react-native-android-widget, etc.).
 *
 * Use this to guard imports/effects that depend on native modules outside
 * Expo Go's bundled set, so the app degrades gracefully (loads + lets you
 * iterate on JS) instead of crashing the bundler.
 *
 * `appOwnership === 'expo'` is the documented signal for Expo Go.
 * https://docs.expo.dev/versions/latest/sdk/constants/#nativeconstants
 */
export const IS_EXPO_GO = Constants.appOwnership === 'expo';
