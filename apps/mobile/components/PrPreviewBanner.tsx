/**
 * A small pill saying which pull request this install is running.
 *
 * Shown on every screen while a preview is loaded, because a preview stays
 * loaded across restarts and the app otherwise looks the same as main. Tapping
 * it opens the screen that switches back.
 *
 * Bottom-left, above the tab bar's expanded height: the top of the screen holds
 * each tab's title on the left and its buttons on the right, and the bottom
 * right is the add button's corner.
 */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';

import { prFromChannel } from '@/lib/pr-preview';
import { TAB_BAR_ROW_HEIGHT } from '@/lib/tab-bar-motion';

export default function PrPreviewBanner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pr = prFromChannel(Updates.channel);
  if (pr === null) return null;

  return (
    <Pressable
      onPress={() => router.push('/preview-pr' as never)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Running pull request ${pr}. Open preview settings.`}
      style={({ pressed }) => [
        styles.pill,
        // Clears the tab bar's expanded height on the tab screens. Elsewhere
        // it just sits a little higher.
        { bottom: insets.bottom + TAB_BAR_ROW_HEIGHT + 12 },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name="git-pull-request" size={12} color="#fff" />
      <Text style={styles.text}>PR #{pr}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(17, 24, 39, 0.82)',
    zIndex: 9999,
  },
  pressed: { opacity: 0.7 },
  text: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
