import React, { useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import {
  OVERDUE_COLOR,
  PRIORITY_CONFIG,
  TASK_MOVE_EXIT_MS,
  addDaysLocalISO,
  resolveQuickSchedule,
  todayLocalISO,
} from '@do-done/shared';
import type { Task, UpdateTaskInput } from '@do-done/shared';
import { hapticLight } from '@/lib/haptics';
import { bulkRescheduleTasks, updateTask } from '@/lib/task-queries';
import { prefersReducedMotion, useRowExit, type RowExit } from '@/lib/use-row-exit';
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

type Target = Parameters<typeof buildReschedule>[1];

function warn(failed: number) {
  if (failed === 0) return;
  Alert.alert(
    `Couldn't reschedule ${failed} task${failed > 1 ? 's' : ''}`,
    'Those tasks were left unchanged. Check your connection and try again.'
  );
}

/**
 * Overdue tasks on Today, each with its own reschedule chips.
 *
 * Every action here moves a task out of this card, since a rescheduled task is
 * no longer overdue. So every action plays the move exit (fade, then close)
 * and the cache moves the task once it has played: a row when one task goes,
 * the whole card when the last one does or "Reschedule all" is used. Before,
 * these wrote straight to the API with no optimistic patch, showed a spinner
 * for a round trip, and then the rows vanished and reappeared elsewhere. The
 * whole card went at once on "Reschedule all", so the list jumped up by its
 * height and back down as the rows arrived.
 *
 * Writes go through `updateTask` / `bulkRescheduleTasks`, so they patch the
 * cache, roll back on failure and report the status ↔ schedule auto-sync like
 * every other write.
 */
export default function OverdueSection({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  // A separate component so the card's exit state is thrown away with it. The
  // next time something is overdue, a fresh card starts at full height.
  return <OverdueCard tasks={tasks} />;
}

function OverdueCard({ tasks }: { tasks: Task[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const card = useRowExit(false);
  // Rows already closing, so a second quick tap still knows when it is
  // taking the last row and should close the card instead.
  const leaving = useRef(new Set<string>());

  /**
   * Reschedule one task. When it is the last one, the card closes instead of
   * the row: a row closing inside a card that then vanishes in one frame is
   * the jump this exists to remove.
   */
  function applyOne(task: Task, target: Target, row: RowExit) {
    hapticLight();
    const animate = !prefersReducedMotion();
    leaving.current.add(task.id);
    const staying = tasks.filter((t) => !leaving.current.has(t.id));
    const exit = staying.length === 0 ? card : row;
    if (animate) exit.startMove();
    void updateTask(task.id, buildReschedule(task, target), {
      holdMs: animate ? TASK_MOVE_EXIT_MS : 0,
    })
      .catch(() => {
        exit.cancel();
        // A later tap may have closed the whole card on the assumption that
        // this row was going. It is staying, so the card has to open again.
        card.cancel();
        warn(1);
      })
      .finally(() => leaving.current.delete(task.id));
  }

  function bulkReschedule(date: string) {
    hapticLight();
    setBulkPending(true);
    const animate = !prefersReducedMotion();
    if (animate) card.startMove();
    void bulkRescheduleTasks(
      tasks.map((t) => t.id),
      date,
      { holdMs: animate ? TASK_MOVE_EXIT_MS : 0 }
    )
      .then(({ failed }) => {
        // On full success the card unmounts once the cache has moved every
        // row, so it is left closed. Rows that did not land stay, and so does
        // the card.
        if (failed > 0) {
          card.cancel();
          warn(failed);
        }
      })
      .catch(() => {
        card.cancel();
        warn(tasks.length);
      })
      .finally(() => setBulkPending(false));
  }

  return (
    <Animated.View
      style={[card.collapsing && styles.exitShell, card.style]}
      onLayout={card.onLayout}
    >
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
              <Text style={styles.headerCountText}>{tasks.length}</Text>
            </View>
          </Pressable>
        </View>
        <View style={styles.bulkRow}>
          <Text style={styles.bulkRowLabel}>Reschedule all</Text>
          <BulkBtn
            label="Today"
            emphasis
            disabled={bulkPending}
            onPress={() => bulkReschedule(todayLocalISO())}
          />
          <BulkBtn
            label="Tomorrow"
            disabled={bulkPending}
            onPress={() => bulkReschedule(addDaysLocalISO(1))}
          />
          <BulkBtn
            label="Next week"
            disabled={bulkPending}
            onPress={() => bulkReschedule(resolveQuickSchedule('next_week'))}
          />
        </View>
        {!collapsed &&
          tasks.map((t) => (
            <OverdueRow
              key={t.id}
              task={t}
              onApply={applyOne}
              // A row chip during "Reschedule all" would send a second write
              // for the same task.
              disabled={bulkPending}
            />
          ))}
      </View>
    </Animated.View>
  );
}

function OverdueRow({
  task: t,
  onApply,
  disabled,
}: {
  task: Task;
  onApply: (task: Task, target: Target, row: RowExit) => void;
  disabled: boolean;
}) {
  const exit = useRowExit(false);
  const apply = (target: Target) => {
    if (!disabled) onApply(t, target, exit);
  };
  return (
    <Animated.View
      style={[exit.collapsing && styles.exitShell, exit.style]}
      onLayout={exit.onLayout}
    >
      <View style={styles.row}>
        <View style={styles.titleLine}>
          <View
            style={[
              styles.dot,
              { backgroundColor: PRIORITY_CONFIG[t.priority].color },
            ]}
          />
          <LinkifiedText text={t.title} style={styles.title} numberOfLines={2} />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <Chip
            label="Today"
            emphasis
            onPress={() => apply({ kind: 'date', date: todayLocalISO() })}
          />
          <Chip
            label="Tomorrow"
            onPress={() => apply({ kind: 'date', date: addDaysLocalISO(1) })}
          />
          <Chip
            label="This week"
            onPress={() =>
              apply({ kind: 'date', date: resolveQuickSchedule('this_week') })
            }
          />
          <Chip label="×" onPress={() => apply({ kind: 'remove' })} />
        </ScrollView>
      </View>
    </Animated.View>
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
  // The spacing between rows is padding inside each row rather than a `gap`
  // on the list, so a row that closes takes its spacing with it.
  row: {
    flexDirection: 'column',
    gap: 6,
    paddingVertical: 7,
  },
  exitShell: { overflow: 'hidden' as const },
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
