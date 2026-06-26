import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  PRIORITY_CONFIG,
  addDaysLocalISO,
  resolveQuickSchedule,
  todayLocalISO,
} from '@do-done/shared';
import type { Task, UpdateTaskInput } from '@do-done/shared';
import { getTasksApi } from '@/lib/supabase';
import { hapticLight } from '@/lib/haptics';

function buildReschedule(
  task: Task,
  target: { kind: 'date'; date: string } | { kind: 'remove' }
): UpdateTaskInput {
  if (target.kind === 'remove') {
    return {
      when_date: null,
      due_date: null,
      due_time: null,
    };
  }
  const input: UpdateTaskInput = { when_date: target.date };
  if (task.due_date && task.due_date < target.date) {
    input.due_date = target.date;
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

  async function applyOne(
    task: Task,
    target: Parameters<typeof buildReschedule>[1]
  ) {
    hapticLight();
    setBusy(true);
    const api = await getTasksApi();
    await api.update(task.id, buildReschedule(task, target));
    setBusy(false);
    setHidden((p) => new Set(p).add(task.id));
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
    await api.bulkUpdate(updates);
    setBusy(false);
    setHidden((prev) => {
      const next = new Set(prev);
      visible.forEach((t) => next.add(t.id));
      return next;
    });
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
          <Text style={styles.headerTitle}>Overdue ({visible.length})</Text>
        </Pressable>
        {busy && <ActivityIndicator color="#dc2626" size="small" />}
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
                <Text style={styles.title} numberOfLines={2}>
                  {t.title}
                </Text>
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
  headerCaret: { color: '#b91c1c', fontSize: 10 },
  headerTitle: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  bulkBtnEmphasis: { backgroundColor: '#dc2626' },
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
