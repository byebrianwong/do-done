/**
 * Live preview of what the natural-language parser extracted from a quick-add
 * string, so the user can trust the parse before submitting (Phase 3.1).
 * Shown above the QuickAddBar as the user types; renders nothing until the
 * parser finds at least one piece of structured metadata.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseTaskInput } from '@do-done/task-engine';
import { PRIORITY_CONFIG, formatDuration } from '@do-done/shared';
import { PRIORITY_COLORS } from './TaskEditModalV2';

function dateLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

type ChipSpec = {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
};

export default function ParsePreview({
  text,
  omitChipFields = false,
}: {
  text: string;
  /**
   * Drop When / Priority / Estimate from the preview. Set it on surfaces that
   * already expose those as chips, so the preview only echoes what the chips
   * don't cover (deadline, tags, recurrence).
   */
  omitChipFields?: boolean;
}) {
  const chips = useMemo<ChipSpec[]>(() => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const parsed = parseTaskInput(trimmed);
    const out: ChipSpec[] = [];

    if (!omitChipFields && parsed.scheduled_date) {
      out.push({
        key: 'scheduled',
        icon: 'calendar-outline',
        label: `${dateLabel(parsed.scheduled_date)}${parsed.scheduled_time ? ` ${parsed.scheduled_time}` : ''}`,
        color: '#4338ca',
      });
    }
    if (parsed.deadline_date) {
      out.push({
        key: 'deadline',
        icon: 'flag-outline',
        label: `by ${dateLabel(parsed.deadline_date)}${parsed.deadline_time ? ` ${parsed.deadline_time}` : ''}`,
        color: '#b45309',
      });
    }
    if (!omitChipFields && parsed.priority) {
      out.push({
        key: 'pri',
        icon: 'flag',
        label: PRIORITY_CONFIG[parsed.priority].label,
        color: PRIORITY_COLORS[parsed.priority],
      });
    }
    if (!omitChipFields && parsed.duration_minutes) {
      out.push({
        key: 'dur',
        icon: 'time-outline',
        label: formatDuration(parsed.duration_minutes),
        color: '#4338ca',
      });
    }
    if (parsed.recurrence_rule) {
      out.push({
        key: 'rec',
        icon: 'repeat',
        label: 'Repeats',
        color: '#0e7490',
      });
    }
    for (const tag of parsed.tags ?? []) {
      out.push({
        key: `tag-${tag}`,
        icon: 'pricetag-outline',
        label: `#${tag}`,
        color: '#4338ca',
      });
    }
    return out;
  }, [text, omitChipFields]);

  if (chips.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.row}
    >
      {chips.map((c) => (
        <View key={c.key} style={styles.chip}>
          <Ionicons name={c.icon} size={12} color={c.color} />
          <Text style={[styles.chipLabel, { color: c.color }]}>{c.label}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 8,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eef2ff',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
});
