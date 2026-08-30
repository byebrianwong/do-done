import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  OVERDUE_COLOR,
  PRIORITY_CONFIG,
  addDaysLocalISO,
  resolveQuickSchedule,
  todayLocalISO,
} from '@do-done/shared';
import type { Task, UpdateTaskInput } from '@do-done/shared';
import { getTasksApi } from '@/lib/supabase';
import { hapticLight } from '@/lib/haptics';
import { LinkifiedText } from './LinkifiedText';

function buildReschedule(
  task: Task,
  target: { kind: 'date'; date: string } | { kind: 'remove' }
): UpdateTaskInput {
  if (target.kind === 'remove') {
    return {
      scheduled_date: null,
      deadline_date: null,
      deadline_time: null,
    };
  }
  const input: UpdateTaskInput = { scheduled_date: target.date };
  if (task.deadline_date && task.deadline_date < target.date) {
    input.deadline_date = target.date;
  }
  return input;
}

export default function OverdueSection({
  tasks,
  onChange,
}: {
  tasks: Task[];
  onChange?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (tasks.length === 0) return null;
  const visible = tasks.filter((t) => !hidden.has(t.id));
  if (visible.length === 0) return null;

  // Rows are hidden locally the moment they're rescheduled, so only hide the
  // ones that actually landed: hiding a failed write makes the reschedule look
  // like it worked right up until the next refetch puts the row back.
  function hide(ids: string[]) {
    if (ids.length === 0) return;
    setHidden((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function warn(failed: number) {
    if (failed === 0) return;
    Alert.alert(
      `Couldn't reschedule ${failed} task${failed > 1 ? 's' : ''}`,
      'Those tasks were left unchanged. Check your connection and try again.'
    );
  }

  async function applyOne(
    task: Task,
    target: Parameters<typeof buildReschedule>[1]
  ) {
    hapticLight();
    setBusy(true);
    const api = await getTasksApi();
    const { error } = await api.update(task.id, buildReschedule(task, target));
    setBusy(false);
    if (error) {
      warn(1);
    } else {
      hide([task.id]);
    }
    onChange?.();
  }

  async function bulkReschedule(date: string) {
    hapticLight();
    setBusy(true);
    const api = await getTasksApi();
    const target = { kind: 'date' as const, date };
    const updates = visible.map((t) => ({
      id: t.id,
      input: buildReschedule(t, target),
    }));
    const { failedIds } = await api.bulkUpdate(updates);
    setBusy(false);
    const failed = new Set(failedIds);
    hide(visible.filter((t) => !failed.has(t.id)).map((t) => t.id));
    warn(failed.size);
    onChange?.();
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable
          onPress={() => setCollapsed((v) => !v)}
          hitSlop={8}
          style={styles.headerLeft}
        >
          <Text style={styles.headerCaret}>{collapsed ? '▶' : '▼'}</Text>
          <Text style={styles.headerTitle}>Overdue</Text>
          <View style={styles.headerCount}>
            <Text style={styles.headerCountText}>{visible.length}</Text>
          </View>
        </Pressable>
        {busy && <ActivityIndicator color={OVERDUE_COLOR} size="small" />}
      </View>
      <View style={styles.bulkRow}>
        <Text style={styles.bulkRowLabel}>Reschedule all</Text>
        <BulkBtn
          label="Today"
          emphasis
          disabled={busy}
          onPress={() => bulkReschedule(todayLocalISO())}
        />
        <BulkBtn
          label="Tomorrow"
          disabled={busy}
          onPress={() => bulkReschedule(addDaysLocalISO(1))}
        />
        <BulkBtn
          label="Next week"
          disabled={busy}
          onPress={() => bulkReschedule(resolveQuickSchedule('next_week'))}
        />
      </View>
      {!collapsed && (
        <View style={styles.list}>
          {visible.map((t) => (
            <View key={t.id} style={styles.row}>
              <View style={styles.titleLine}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: PRIORITY_CONFIG[t.priority].color },
                  ]}
                />
                <LinkifiedText
                  text={t.title}
                  style={styles.title}
                  numberOfLines={2}
                />
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                <Chip
                  label="Today"
                  emphasis
                  onPress={() =>
                    applyOne(t, { kind: 'date', date: todayLocalISO() })
                  }
                />
                <Chip
                  label="Tomorrow"
                  onPress={() =>
                    applyOne(t, { kind: 'date', date: addDaysLocalISO(1) })
                  }
                />
                <Chip
                  label="This week"
                  onPress={() =>
                    applyOne(t, {
                      kind: 'date',
                      date: resolveQuickSchedule('this_week'),
                    })
                  }
                />
                <Chip
                  label="×"
                  onPress={() => applyOne(t, { kind: 'remove' })}
                />
              </ScrollView>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function BulkBtn({
  label,
  onPress,
  emphasis,
  disabled,
}: {
  label: string;
  onPress: () => void;
  emphasis?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.bulkBtn,
        emphasis ? styles.bulkBtnEmphasis : styles.bulkBtnSoft,
        disabled && styles.bulkBtnBusy,
      ]}
      hitSlop={4}
    >
      <Text
        style={[
          styles.bulkLabel,
          emphasis ? styles.bulkLabelEmphasis : styles.bulkLabelSoft,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Chip({
  label,
  onPress,
  emphasis,
}: {
  label: string;
  onPress: () => void;
  emphasis?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, emphasis && styles.chipEmphasis]}
      hitSlop={4}
    >
      <Text style={[styles.chipLabel, emphasis && styles.chipLabelEmphasis]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // The count pill every other section header uses, in this one's red.
  headerCount: {
    borderRadius: 999,
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  headerCountText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#b91c1c',
    fontVariant: ['tabular-nums'],
  },
  headerCaret: { color: '#b91c1c', fontSize: 10 },
  // Sentence case at the list's heading size, matching every other section
  // header. Red stays: this section's whole identity is that it is late.
  headerTitle: {
    color: '#b91c1c',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  bulkRowLabel: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '600',
    marginRight: 2,
  },
  bulkBtn: {
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  bulkBtnEmphasis: { backgroundColor: OVERDUE_COLOR },
  bulkBtnSoft: {
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
    borderWidth: StyleSheet.hairlineWidth,
  },
  bulkBtnBusy: { opacity: 0.5 },
  bulkLabel: { fontSize: 12, fontWeight: '700' },
  bulkLabelEmphasis: { color: '#fff' },
  bulkLabelSoft: { color: '#b91c1c' },
  list: { gap: 6 },
  row: {
    flexDirection: 'column',
    gap: 6,
    paddingVertical: 4,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 14, color: '#111827', flex: 1 },
  chipRow: { gap: 4, paddingRight: 4 },
  chip: {
    backgroundColor: '#fff',
    borderColor: '#e5e7eb',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  chipEmphasis: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  chipLabel: { fontSize: 12, color: '#374151', fontWeight: '600' },
  chipLabelEmphasis: { color: '#4338ca' },
});
