import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Thin, fire-and-forget wrappers around expo-haptics. Each is a no-op on web
 * and swallows errors (a device may have haptics disabled or unavailable), so
 * call sites never need to guard. expo-haptics is bundled in Expo Go, so these
 * work without a custom dev build.
 */

export function hapticSelection(): void {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => {});
}

export function hapticLight(): void {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function hapticMedium(): void {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function hapticSuccess(): void {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    () => {}
  );
}
