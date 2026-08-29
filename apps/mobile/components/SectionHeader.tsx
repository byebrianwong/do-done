import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * How a list names one of its sections, on every mobile list screen.
 *
 * The label was `fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
 * letterSpacing: 0.5` in grey, which failed at its one job: at 12px, grey, in
 * caps it was *quieter* than the 15px near-black titles below it, so the eye
 * read the rows and skipped the thing naming them. Sentence case at 14px in the
 * title colour is louder than the rows without being bigger.
 *
 * Four screens share these styles — the grouped list, Today, Upcoming and
 * Completed — because four copies of the same StyleSheet is exactly how a
 * section comes to be named one way on one screen and another way on the next.
 * They were four copies before this.
 *
 * **The background must stay opaque.** These headers are sticky now, so a
 * transparent one lets the rows scroll *through* the words instead of under
 * them. `#f3f4f6` is the screen's own background, which is what makes a pinned
 * header read as part of the list rather than as a floating bar.
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
 * A pill rather than "(6)" so it reads as a quantity attached to the label
 * rather than as part of the sentence, and `tabular-nums` so a "12" sits where
 * a "6" did. Matches web's, deliberately — the same list on two devices should
 * not count differently.
 */
export function SectionCount({ value }: { value: number }) {
  return (
    <View style={countStyles.pill}>
      <Text style={countStyles.text}>{value}</Text>
    </View>
  );
}
