import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatEventTime, type CalendarEvent } from '@do-done/shared';

/**
 * A read-only Google Calendar event row (Today's schedule, Upcoming day
 * groups). Deliberately quieter than a task row — a hollow colored dot
 * (events) vs the filled checkbox (tasks) — and it opens Google Calendar on
 * tap since events are edited there, not in DoDone.
 */
export default function CalendarEventRow({ event }: { event: CalendarEvent }) {
  const color = event.color ?? '#6366f1';
  const time = formatEventTime(event) ?? 'All day';

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={
        event.html_link
          ? () => {
              void Linking.openURL(event.html_link!).catch(() => {});
            }
          : undefined
      }
    >
      <View style={[styles.dot, { borderColor: color }]} />
      <Text style={styles.time}>{time}</Text>
      <Text style={styles.title} numberOfLines={1}>
        {event.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 5,
  },
  rowPressed: { opacity: 0.6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  time: {
    fontSize: 12,
    color: '#9ca3af',
    fontVariant: ['tabular-nums'],
  },
  title: {
    flex: 1,
    fontSize: 13,
    color: '#4b5563',
  },
});
