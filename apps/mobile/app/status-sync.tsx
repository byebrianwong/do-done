import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DEFAULT_STATUS_SYNC,
  STATUS_CONFIG,
  SYNC_TARGET_STATUSES,
  describeStatusSyncHorizon,
  parseStatusSyncSettings,
  type StatusSyncSettings,
  type UpdateStatusSyncInput,
} from '@do-done/shared';
import { getTasksApi, getUserPrefsApi } from '@/lib/supabase';
import { queryClient } from '@/lib/query-client';
import { taskKeys } from '@/lib/task-queries';

/**
 * The horizon picker flattens the two stored representations — a day count and
 * a weekday anchor — into one list, because "in 3 days" and "this weekend" are
 * the same kind of answer to the user even though they're different arithmetic.
 *
 * Each option carries two phrasings, because the two halves of the rule mean
 * different things by the same horizon. Promote asks whether a date falls in a
 * *window*; backfill writes one specific *day*. "Within the next 3 days" and
 * "for Friday" are both right, and swapping them reads as nonsense.
 */
const HORIZON_OPTIONS: {
  value: string;
  /** Names the span — the chip label, and the promote sentence. */
  window: string;
  /** Names the single day backfill would write. */
  day: string;
  patch: UpdateStatusSyncInput;
}[] = [
  ...[
    { days: 0, window: 'today', day: 'today' },
    { days: 1, window: 'today or tomorrow', day: 'tomorrow' },
    { days: 2, window: 'the next 2 days', day: '2 days from now' },
    { days: 3, window: 'the next 3 days', day: '3 days from now' },
    { days: 5, window: 'the next 5 days', day: '5 days from now' },
    { days: 7, window: 'the next 7 days', day: 'a week from now' },
    { days: 14, window: 'the next 14 days', day: 'two weeks from now' },
  ].map(({ days, window, day }) => ({
    value: `days:${days}`,
    window,
    day,
    patch: {
      status_sync_horizon_kind: 'days' as const,
      status_sync_horizon_days: days,
      status_sync_horizon_key: DEFAULT_STATUS_SYNC.status_sync_horizon_key,
    },
  })),
  {
    value: 'quick:this_week',
    window: 'this week',
    day: 'Friday',
    patch: {
      status_sync_horizon_kind: 'quick' as const,
      status_sync_horizon_days: DEFAULT_STATUS_SYNC.status_sync_horizon_days,
      status_sync_horizon_key: 'this_week' as const,
    },
  },
  {
    value: 'quick:this_weekend',
    window: 'this weekend',
    day: 'Sunday',
    patch: {
      status_sync_horizon_kind: 'quick' as const,
      status_sync_horizon_days: DEFAULT_STATUS_SYNC.status_sync_horizon_days,
      status_sync_horizon_key: 'this_weekend' as const,
    },
  },
];

function horizonValue(s: StatusSyncSettings): string {
  return s.status_sync_horizon_kind === 'quick'
    ? `quick:${s.status_sync_horizon_key}`
    : `days:${s.status_sync_horizon_days}`;
}

function phrases(s: StatusSyncSettings): { window: string; day: string } {
  const opt = HORIZON_OPTIONS.find((o) => o.value === horizonValue(s));
  // A horizon saved from another surface (or a future option) still needs to
  // render something true.
  const fallback = describeStatusSyncHorizon(s);
  return { window: opt?.window ?? fallback, day: opt?.day ?? fallback };
}

/** A row of mutually exclusive chips — the picker idiom the task editor uses. */
function ChipRow<T extends string>({
  options,
  value,
  disabled,
  onSelect,
}: {
  options: { value: T; label: string }[];
  value: T;
  disabled: boolean;
  onSelect: (v: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            disabled={disabled}
            onPress={() => onSelect(o.value)}
            style={[
              styles.chip,
              active && styles.chipActive,
              disabled && styles.chipDisabled,
            ]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function StatusSyncScreen() {
  const [settings, setSettings] = useState<StatusSyncSettings | 'error' | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  // Bumped by Retry — the load lives in an effect, so it needs a dependency to
  // re-run on rather than a state value it sets itself.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = await getUserPrefsApi();
        const { data, error } = await api.get();
        if (cancelled) return;
        // Don't show settings we can't back up — surface a retry instead.
        setSettings(error ? 'error' : parseStatusSyncSettings(data));
      } catch {
        if (!cancelled) setSettings('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  async function save(patch: UpdateStatusSyncInput) {
    if (!settings || settings === 'error') return;
    const before = settings;
    setSettings({ ...settings, ...patch });
    setSaving(true);
    try {
      const prefs = await getUserPrefsApi();
      const { error } = await prefs.updateStatusSync(patch);
      if (error) throw error;

      // This TasksApi is a long-lived singleton with its own settings cache;
      // without this the switch just flipped would sit inert for up to a
      // minute.
      const tasks = await getTasksApi();
      tasks.invalidateStatusSyncCache();

      // Apply the new rule to the list right away, or the switch reads as
      // broken: nothing visibly happens until a task is touched.
      const next = { ...before, ...patch };
      if (next.status_sync_promote) {
        const { updated } = await tasks.syncScheduledToStatus();
        if (updated > 0) {
          void queryClient.invalidateQueries({ queryKey: taskKeys.all });
        }
      }
    } catch {
      setSettings(before);
      Alert.alert('Could not save', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (settings === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  if (settings === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Couldn’t load your settings.</Text>
        <Pressable
          onPress={() => {
            setSettings(null);
            setReloads((n) => n + 1);
          }}
          hitSlop={8}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const statusLabel = STATUS_CONFIG[settings.status_sync_status]?.label ?? 'Next';
  const { window: windowPhrase, day: dayPhrase } = phrases(settings);
  const idle = !settings.status_sync_promote && !settings.status_sync_backfill;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        A task’s status and the day it’s scheduled for are usually saying the
        same thing. Let DoDone keep them in step.
      </Text>

      <View style={styles.section}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleLabel}>
              Move tasks scheduled within {windowPhrase} to {statusLabel}
            </Text>
            <Text style={styles.toggleHint}>
              Happens when you schedule a task, and when its day comes near.
              Move one back afterwards and it stays where you put it. Anything
              already at {statusLabel} or further along is left alone, and
              overdue tasks count as near.
            </Text>
          </View>
          <Switch
            value={settings.status_sync_promote}
            disabled={saving}
            onValueChange={(v) => void save({ status_sync_promote: v })}
            trackColor={{ true: '#6366f1' }}
          />
        </View>

        <View style={[styles.toggleRow, styles.toggleRowLast]}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleLabel}>
              Schedule tasks you move to {statusLabel} for {dayPhrase}
            </Text>
            <Text style={styles.toggleHint}>
              Only when the task has no scheduled date, or one further out. A
              date you pick yourself always wins.
            </Text>
          </View>
          <Switch
            value={settings.status_sync_backfill}
            disabled={saving}
            onValueChange={(v) => void save({ status_sync_backfill: v })}
            trackColor={{ true: '#6366f1' }}
          />
        </View>
      </View>

      <Text style={styles.sectionHeader}>Status</Text>
      <View style={styles.pickerCard}>
        <ChipRow
          options={SYNC_TARGET_STATUSES.map((s) => ({
            value: s,
            label: STATUS_CONFIG[s]?.label ?? s,
          }))}
          value={settings.status_sync_status}
          disabled={saving || idle}
          onSelect={(v) => void save({ status_sync_status: v })}
        />
      </View>

      <Text style={styles.sectionHeader}>Window</Text>
      <View style={styles.pickerCard}>
        <ChipRow
          options={HORIZON_OPTIONS.map((o) => ({
            value: o.value,
            label: o.window,
          }))}
          value={horizonValue(settings)}
          disabled={saving || idle}
          onSelect={(v) => {
            const opt = HORIZON_OPTIONS.find((o) => o.value === v);
            if (opt) void save(opt.patch);
          }}
        />
      </View>

      <View style={styles.footnote}>
        <Ionicons name="information-circle-outline" size={16} color="#9ca3af" />
        <Text style={styles.footnoteText}>
          Both rules are off until you turn them on, and they apply everywhere —
          web, mobile, and anything talking to DoDone through MCP.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 40 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#f3f4f6',
  },
  errorText: { fontSize: 15, color: '#6b7280' },
  retryText: { fontSize: 15, color: '#6366f1', fontWeight: '600' },
  intro: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6b7280',
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 16,
  },
  section: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  toggleRowLast: { borderBottomWidth: 0 },
  toggleText: { flex: 1 },
  toggleLabel: { fontSize: 16, color: '#111827', lineHeight: 22 },
  toggleHint: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
    marginTop: 4,
  },
  pickerCard: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  chipActive: { backgroundColor: '#eef2ff', borderColor: '#6366f1' },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: 14, color: '#4b5563' },
  chipTextActive: { color: '#4338ca', fontWeight: '600' },
  footnote: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 20,
  },
  footnoteText: {
    flex: 1,
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 17,
  },
});
