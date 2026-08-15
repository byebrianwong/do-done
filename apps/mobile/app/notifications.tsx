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
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT_NAMES,
  formatClockLabel,
  parseClockTime,
  parseNotificationSettings,
  type NotificationSettings,
  type UpdateNotificationSettingsInput,
} from '@do-done/shared';
import { getUserPrefsApi } from '@/lib/supabase';
import {
  hasNotificationPermission,
  notificationsSupported,
  requestNotificationPermission,
} from '@/lib/notifications';
import { rearmDigests, sendTestDigest } from '@/lib/digests';

/**
 * Digest settings.
 *
 * Two switches and their schedules. The screen also owns the OS permission
 * prompt, because turning a digest on is the only moment in the app where
 * asking for notification access explains itself — the same rule the location
 * reminder sheet follows (see CLAUDE.md → Location reminders): never on launch,
 * never on sign-in, always at the point the user asked for the thing that needs
 * it.
 */

// Times are offered as a list rather than a wheel. A digest is a habit anchored
// to a part of the day, not an appointment — nobody needs 07:23 — and a picker
// is a native module and a second permission-shaped decision for a value with
// eight sensible answers.
const TIME_OPTIONS = [
  '06:00',
  '07:00',
  '08:00',
  '09:00',
  '12:00',
  '17:00',
  '18:00',
  '20:00',
];

function TimeRow({
  value,
  disabled,
  onSelect,
}: {
  value: string;
  disabled: boolean;
  onSelect: (v: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {TIME_OPTIONS.map((t) => {
        const active = t === value;
        return (
          <Pressable
            key={t}
            disabled={disabled}
            onPress={() => onSelect(t)}
            style={[
              styles.chip,
              active && styles.chipActive,
              disabled && styles.chipDisabled,
            ]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {formatClockLabel(t)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function WeekdayRow({
  value,
  disabled,
  onSelect,
}: {
  value: number;
  disabled: boolean;
  onSelect: (v: number) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {WEEKDAY_SHORT_NAMES.map((name, i) => {
        const active = i === value;
        return (
          <Pressable
            key={name}
            disabled={disabled}
            onPress={() => onSelect(i)}
            style={[
              styles.dayChip,
              active && styles.chipActive,
              disabled && styles.chipDisabled,
            ]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function NotificationsScreen() {
  const [settings, setSettings] = useState<
    NotificationSettings | 'error' | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [permitted, setPermitted] = useState<boolean | null>(null);
  const [reload, setReload] = useState(0);
  const supported = notificationsSupported();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const api = await getUserPrefsApi();
        const { data, error } = await api.get();
        if (cancelled) return;
        if (error) setSettings('error');
        else setSettings(parseNotificationSettings(data));
      } catch {
        if (!cancelled) setSettings('error');
      }
      const granted = await hasNotificationPermission();
      if (!cancelled) setPermitted(granted);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const live = settings && settings !== 'error' ? settings : null;

  /**
   * Save a patch, then re-arm.
   *
   * Optimistic, and rolled back to what was on screen rather than to the
   * inverse of the patch. The re-arm is awaited but its result ignored: a
   * failure there leaves the setting saved and the next foreground re-tries,
   * which is better than refusing the setting because the OS was busy.
   */
  async function save(patch: UpdateNotificationSettingsInput) {
    if (!live) return;
    const previous = live;
    const next = { ...live, ...patch } as NotificationSettings;
    setSettings(next);
    setSaving(true);
    try {
      const api = await getUserPrefsApi();
      const { error } = await api.updateNotificationSettings(patch);
      if (error) throw error;
      await rearmDigests();
    } catch {
      setSettings(previous);
      Alert.alert('Could not save', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Turning a digest on asks for the OS grant first, and doesn't save when it
   * is refused. Saving anyway would leave a switch that says "on" above a
   * feature the OS will never let post anything — the exact state that makes a
   * notification feature look broken rather than declined.
   */
  async function toggle(
    field: 'notify_daily_digest' | 'notify_weekly_digest',
    on: boolean
  ) {
    if (on) {
      const granted = await requestNotificationPermission();
      setPermitted(granted);
      if (!granted) {
        Alert.alert(
          'Notifications are off',
          'DoDone needs permission to post notifications. Turn them on in system settings, then try again.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open settings', onPress: () => void Linking.openSettings() },
          ]
        );
        return;
      }
    }
    await save({ [field]: on } as UpdateNotificationSettingsInput);
  }

  async function test() {
    const granted = await requestNotificationPermission();
    setPermitted(granted);
    if (!granted) {
      Alert.alert(
        'Notifications are off',
        'Turn them on in system settings to see a test digest.'
      );
      return;
    }
    const ok = await sendTestDigest();
    if (!ok) {
      Alert.alert('Could not send', 'The notification could not be posted.');
    }
  }

  if (!supported) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={20} color="#6b7280" />
          <Text style={styles.noticeText}>
            Notifications need a development or release build — they are not
            available in Expo Go.
          </Text>
        </View>
      </ScrollView>
    );
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
        <Text style={styles.errorText}>Could not load your settings.</Text>
        <Pressable onPress={() => setReload((n) => n + 1)} style={styles.retry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const s = settings;
  const daily = parseClockTime(s.notify_daily_digest_time)
    ? s.notify_daily_digest_time
    : DEFAULT_NOTIFICATION_SETTINGS.notify_daily_digest_time;
  const weekly = parseClockTime(s.notify_weekly_digest_time)
    ? s.notify_weekly_digest_time
    : DEFAULT_NOTIFICATION_SETTINGS.notify_weekly_digest_time;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {permitted === false && (s.notify_daily_digest || s.notify_weekly_digest) && (
        <Pressable
          style={styles.warning}
          onPress={() => void Linking.openSettings()}
        >
          <Ionicons name="warning-outline" size={20} color="#b45309" />
          <Text style={styles.warningText}>
            Notifications are turned off for DoDone in system settings, so
            nothing will arrive. Tap to fix.
          </Text>
        </Pressable>
      )}

      <Text style={styles.sectionHeader}>Daily digest</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons
            name="sunny-outline"
            size={20}
            color="#6b7280"
            style={styles.rowIcon}
          />
          <Text style={styles.rowLabel}>Send a daily digest</Text>
          <Switch
            value={s.notify_daily_digest}
            disabled={saving}
            onValueChange={(v) => void toggle('notify_daily_digest', v)}
            trackColor={{ true: '#6366f1' }}
          />
        </View>
        <Text style={styles.hint}>
          What&apos;s on today, including anything overdue.
        </Text>
        {s.notify_daily_digest && (
          <TimeRow
            value={daily}
            disabled={saving}
            onSelect={(v) => void save({ notify_daily_digest_time: v })}
          />
        )}
      </View>

      <Text style={styles.sectionHeader}>Weekly digest</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons
            name="calendar-outline"
            size={20}
            color="#6b7280"
            style={styles.rowIcon}
          />
          <Text style={styles.rowLabel}>Send a weekly digest</Text>
          <Switch
            value={s.notify_weekly_digest}
            disabled={saving}
            onValueChange={(v) => void toggle('notify_weekly_digest', v)}
            trackColor={{ true: '#6366f1' }}
          />
        </View>
        <Text style={styles.hint}>
          The seven days ahead, shaped by day — sent on{' '}
          {WEEKDAY_NAMES[s.notify_weekly_digest_weekday]}s.
        </Text>
        {s.notify_weekly_digest && (
          <>
            <WeekdayRow
              value={s.notify_weekly_digest_weekday}
              disabled={saving}
              onSelect={(v) =>
                void save({ notify_weekly_digest_weekday: v })
              }
            />
            <TimeRow
              value={weekly}
              disabled={saving}
              onSelect={(v) => void save({ notify_weekly_digest_time: v })}
            />
          </>
        )}
      </View>

      {/* Silence is the rule, not a fault — say so, or the first quiet morning
          reads as the feature being broken. */}
      <Text style={styles.footnote}>
        A digest is only sent on a day that has something on it. Times are in
        your account&apos;s timezone.
      </Text>

      <Pressable
        style={({ pressed }) => [styles.testButton, pressed && styles.testPressed]}
        onPress={() => void test()}
      >
        <Text style={styles.testText}>Send one now</Text>
      </Pressable>
      <Text style={styles.hintCentered}>
        Posts today&apos;s digest straight away, so you can see what one looks
        like.
      </Text>

      <Text style={styles.sectionHeader}>Location reminders</Text>
      <View style={styles.section}>
        <Text style={styles.hint}>
          Reminders tied to a place are set up on the task itself — open a task
          and tap the 📍 row. They arrive on their own notification channel, so
          you can silence digests without silencing those.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 48 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    gap: 12,
  },
  errorText: { fontSize: 15, color: '#6b7280' },
  retry: { paddingHorizontal: 16, paddingVertical: 8 },
  retryText: { fontSize: 15, color: '#6366f1', fontWeight: '600' },
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
  section: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    paddingBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowIcon: { marginRight: 12 },
  rowLabel: { flex: 1, fontSize: 16, color: '#111827' },
  hint: {
    fontSize: 13,
    color: '#6b7280',
    paddingHorizontal: 16,
    lineHeight: 18,
  },
  hintCentered: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    marginHorizontal: 32,
    lineHeight: 18,
  },
  footnote: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 16,
    marginHorizontal: 16,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  dayChip: {
    width: 42,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
  },
  chipActive: { backgroundColor: '#6366f1' },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  testButton: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  testPressed: { backgroundColor: '#f9fafb' },
  testText: { fontSize: 16, color: '#6366f1', fontWeight: '600' },
  notice: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  noticeText: { flex: 1, fontSize: 14, color: '#374151', lineHeight: 20 },
  warning: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: '#fef3c7',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
  },
  warningText: { flex: 1, fontSize: 13, color: '#92400e', lineHeight: 18 },
});
