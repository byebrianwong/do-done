/**
 * A screen title that says there is another view behind it.
 *
 * Two of the four tabs hold two views, and only the one you are on is named —
 * printing both would spend the width of the header on a word you are not
 * looking at. So the title is followed by a small tinted circle carrying two
 * arrows, which is the app's existing `pillbtn` (the Projects header's buttons)
 * at the size a title can take.
 *
 * Two arrows rather than the other view's icon: a calendar beside "Today"
 * reads as "pick a date" and a star beside "Upcoming" reads as "favourite", and
 * both of those are real actions in this app. Arrows can only mean switch.
 *
 * The glyph turns over when you use it, so the swap has a direction and the two
 * views read as two sides of one thing rather than two destinations.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  toggleAgendaMode,
  toggleTasksMode,
  useViewMode,
} from '@/lib/view-mode';

interface Props {
  /** The view you are on. The other one is never named. */
  label: string;
  /** True on the second of the pair, which is what turns the glyph over. */
  flipped: boolean;
  onSwap: () => void;
  /** What the swap goes to, for screen readers — the one place it is spelled. */
  swapsTo: string;
}

export function SwapTitle({ label, flipped, onSwap, swapsTo }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{label}</Text>
      <Pressable
        onPress={onSwap}
        // The pill is 28px so it sits under a 22px title without crowding it;
        // hitSlop is what makes the target a thumb's worth.
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${swapsTo}`}
        style={({ pressed }) => [
          styles.pill,
          flipped && styles.pillFlipped,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="swap-horizontal" size={17} color="#4f46e5" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  pill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    // One step up from the `#eef2ff` the 36px header buttons use: at 28px on
    // the same grey the lighter tint stops reading as a control at all.
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillFlipped: { transform: [{ rotate: '180deg' }] },
  pressed: { opacity: 0.7 },
});

/**
 * The Agenda tab's title. Reads the mode itself so each of the two views it
 * fronts stays a one-line change from what it was.
 */
export function AgendaTitle() {
  const { agenda } = useViewMode();
  const today = agenda === 'today';
  return (
    <SwapTitle
      label={today ? 'Today' : 'Upcoming'}
      flipped={!today}
      swapsTo={today ? 'Upcoming' : 'Today'}
      onSwap={toggleAgendaMode}
    />
  );
}

/** The Tasks tab's title: All ⟷ Inbox. */
export function TasksTitle() {
  const { tasks } = useViewMode();
  const all = tasks === 'all';
  return (
    <SwapTitle
      label={all ? 'All' : 'Inbox'}
      flipped={!all}
      swapsTo={all ? 'Inbox' : 'All'}
      onSwap={toggleTasksMode}
    />
  );
}
