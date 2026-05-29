import { Redirect } from 'expo-router';

/**
 * Deep-link target for the "Today" home-screen widget (dodone://today).
 * Renders nothing — it bounces straight to the Today tab.
 */
export default function TodayDeepLink() {
  return <Redirect href="/(tabs)" />;
}
