import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BaseButton } from 'react-native-gesture-handler';

/**
 * How a list names one of its sections, on every mobile list screen.
 *
 * The label was 12px, weight 700, uppercase, letter-spaced, in grey — which
 * failed at its one job: it was quieter than the 15px near-black titles below
 * it, so the eye read the rows and skipped the thing naming them. Sentence case
 * at 14px in the title colour is louder than the rows without being bigger.
 *
 * Four screens share these styles: the grouped list, Today, Upcoming and
 * Completed. They were four copies of the same StyleSheet before, which is how
 * a section comes to be named one way on one screen and another on the next.
 *
 * **The background must stay opaque.** These headers are sticky now, so a
 * transparent one lets rows scroll through the words instead of under them.
 * `#f3f4f6` is the screen's own background, which makes a pinned header read as
 * part of the list rather than as a floating bar.
 */
export const sectionHeaderStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  /** For a section whose whole point is that it is late. */
  overdueText: {},
  dot: { width: 8, height: 8, borderRadius: 4 },
});

const countStyles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  text: {
    fontSize: 11,
    fontWeight: '500',
    // neutral-600, not the neutral-500 the muted text uses: on this pill's own
    // background neutral-500 measures 3.9:1, under the bar for 11px text.
    color: '#4b5563',
    fontVariant: ['tabular-nums'],
  },
});

/**
 * The count beside a section's name.
 *
 * A pill rather than "(6)", so it reads as a quantity attached to the label
 * rather than as part of the sentence, and `tabular-nums` so a "12" sits where
 * a "6" did. Matches web's on purpose: the same list on two devices should not
 * count differently.
 */
export function SectionCount({ value }: { value: number }) {
  return (
    <View style={countStyles.pill}>
      <Text style={countStyles.text}>{value}</Text>
    </View>
  );
}

/**
 * The tappable row of a collapsible section header. Tapping it opens or closes
 * the section.
 *
 * This must not be a React Native `Pressable`. On Android, a `Pressable`
 * inside a pinned sticky header could not be tapped. React Native pins the
 * header with a transform that runs on the native side. When the finger moves
 * even slightly during a tap, Android re-checks what was tapped in JS, using
 * the header's position *before* it was pinned. The tap then went to the row
 * underneath, and the section never opened or closed. Headers that were not
 * pinned worked, which is why it only failed once the list was scrolled.
 *
 * `BaseButton` is gesture-handler's button. It finds its target from the
 * native views as they are drawn, so it hits the pinned header where it is on
 * screen. It does not set `disallowInterruption`, so a drag that starts on a
 * header still scrolls the list.
 *
 * Verified on the iOS simulator only. There is no Android emulator on the
 * machine this was written on, so the Android fix is checked on a device.
 */
export function SectionHeaderButton({
  collapsed,
  onToggle,
  children,
}: {
  collapsed: boolean;
  /** Leave undefined when the section cannot be toggled. */
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <BaseButton
      style={sectionHeaderStyles.container}
      enabled={onToggle != null}
      onPress={onToggle}
      rippleColor="rgba(17,24,39,0.06)"
      accessible
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed, disabled: onToggle == null }}
    >
      {children}
    </BaseButton>
  );
}
