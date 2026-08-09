import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useRouter } from 'expo-router';
import { getUserPrefsApi, supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { queryClient } from '@/lib/query-client';
import { calendarKeys } from '@/lib/calendar-queries';
import { describeNoUpdate } from '@/lib/update-check';

interface SettingsRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value?: string;
  onPress?: () => void;
}

function SettingsRow({ icon, label, value, onPress }: SettingsRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color="#6b7280" style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
    </Pressable>
  );
}

/** A read-only info row (no tap target / chevron). */
function InfoRow({ icon, label, value }: Omit<SettingsRowProps, 'onPress'>) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color="#6b7280" style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValueStrong} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  // null = loading the preference row; 'error' = load failed (shows a retry).
  const [showEvents, setShowEvents] = useState<boolean | 'error' | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const api = await getUserPrefsApi();
        const { data, error } = await api.get();
        if (cancelled) return;
        // Don't show a value we can't back up — surface a retry instead.
        if (error) setShowEvents('error');
        else setShowEvents(data?.show_calendar_events ?? true);
      } catch {
        if (!cancelled) setShowEvents('error');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function retryLoadShowEvents() {
    setShowEvents(null);
    try {
      const api = await getUserPrefsApi();
      const { data, error } = await api.get();
      if (error) throw error;
      setShowEvents(data?.show_calendar_events ?? true);
    } catch {
      setShowEvents('error');
    }
  }

  async function toggleShowEvents(next: boolean) {
    const prev = showEvents; // roll back to what we showed, not just !next
    setShowEvents(next); // optimistic
    try {
      const api = await getUserPrefsApi();
      const { error } = await api.updateShowCalendarEvents(next);
      if (error) throw error;
      // Event lists gate on this pref server-side — refetch them.
      void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
    } catch {
      setShowEvents(prev);
      Alert.alert('Could not save', 'Check your connection and try again.');
    }
  }

  const version = Constants.expoConfig?.version ?? '1.0.0';
  const sha =
    (Constants.expoConfig?.extra?.git as { sha?: string } | undefined)?.sha ??
    'dev';

  // Live info about the currently-running JS bundle (embedded vs OTA update).
  const { currentlyRunning } = Updates.useUpdates();
  const onOta = Updates.isEnabled && !currentlyRunning.isEmbeddedLaunch;
  const sourceLabel = !Updates.isEnabled
    ? 'Dev (updates off)'
    : onOta
      ? 'OTA update'
      : 'Built-in build';
  const updatedAt = currentlyRunning.createdAt
    ? currentlyRunning.createdAt.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';
  const channel = currentlyRunning.channel ?? Updates.channel ?? '—';

  async function checkForUpdates() {
    if (!Updates.isEnabled) {
      Alert.alert(
        'Updates disabled',
        'Over-the-air updates only run in a release build, not in development.'
      );
      return;
    }
    setChecking(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        await Updates.fetchUpdateAsync();
        Alert.alert(
          'Update downloaded',
          'A newer version is ready. Restart to apply it now?',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Restart', onPress: () => Updates.reloadAsync() },
          ]
        );
      } else {
        // Not every "no update" means you have the latest — see describeNoUpdate.
        const { title, body } = describeNoUpdate(result.reason, channel);
        Alert.alert(title, body);
      }
    } catch (e) {
      Alert.alert(
        'Check failed',
        e instanceof Error ? e.message : 'Could not check for updates.'
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {session?.user && (
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(session.user.email?.[0] ?? '?').toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userEmail}>{session.user.email}</Text>
            <Text style={styles.userId} numberOfLines={1}>
              Signed in
            </Text>
          </View>
        </View>
      )}

      <Text style={styles.sectionHeader}>Tasks</Text>
      <View style={styles.section}>
        <SettingsRow
          icon="checkmark-done-circle-outline"
          label="Completed tasks"
          onPress={() => router.push('/completed' as never)}
        />
        <SettingsRow
          icon="location-outline"
          label="Saved places"
          onPress={() => router.push('/locations' as never)}
        />
        <SettingsRow
          icon="sync-outline"
          label="Status and schedule"
          onPress={() => router.push('/status-sync' as never)}
        />
      </View>

      <Text style={styles.sectionHeader}>Calendar Integration</Text>
      <View style={styles.section}>
        <SettingsRow
          icon="calendar-outline"
          label="Google Calendar"
          value="Connect on web"
          onPress={() =>
            Alert.alert(
              'Google Calendar',
              'Connect your calendar from the DoDone web app. Once connected, scheduled tasks stay in sync and your calendar events show up in Today and Upcoming here.'
            )
          }
        />
        <View style={styles.row}>
          <Ionicons
            name="today-outline"
            size={20}
            color="#6b7280"
            style={styles.rowIcon}
          />
          <Text style={styles.rowLabel}>Show calendar events</Text>
          {showEvents === null ? (
            <ActivityIndicator size="small" color="#9ca3af" />
          ) : showEvents === 'error' ? (
            <Pressable onPress={() => void retryLoadShowEvents()} hitSlop={8}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : (
            <Switch
              value={showEvents}
              onValueChange={(v) => {
                void toggleShowEvents(v);
              }}
              trackColor={{ true: '#6366f1' }}
            />
          )}
        </View>
        {/* Only meaningful while events are being shown — hidden otherwise,
            matching the web settings page. */}
        {showEvents === true && (
          <SettingsRow
            icon="list-outline"
            label="Calendars to show"
            onPress={() => router.push('/calendars')}
          />
        )}
      </View>

      <Text style={styles.sectionHeader}>App version</Text>
      <View style={styles.section}>
        <InfoRow
          icon="information-circle-outline"
          label="Version"
          value={`${version} (${sha})`}
        />
        <InfoRow icon="git-branch-outline" label="Channel" value={channel} />
        <InfoRow
          icon={onOta ? 'cloud-done-outline' : 'phone-portrait-outline'}
          label="Running"
          value={sourceLabel}
        />
        <InfoRow icon="time-outline" label="Last updated" value={updatedAt} />
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.updateButton,
          pressed && styles.updateButtonPressed,
        ]}
        onPress={checkForUpdates}
        disabled={checking}
      >
        {checking ? (
          <ActivityIndicator color="#6366f1" />
        ) : (
          <Text style={styles.updateText}>Check for updates</Text>
        )}
      </Pressable>
      <Text style={styles.updateHint}>
        New versions ship automatically — fully close and reopen the app to pick
        them up, or tap above to check now.
      </Text>

      <Pressable
        style={({ pressed }) => [
          styles.signoutButton,
          pressed && styles.signoutButtonPressed,
        ]}
        onPress={() => supabase.auth.signOut()}
      >
        <Text style={styles.signoutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  content: {
    paddingBottom: 40,
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
  section: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  rowPressed: {
    backgroundColor: '#f9fafb',
  },
  rowIcon: {
    marginRight: 12,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  rowValue: {
    fontSize: 14,
    color: '#9ca3af',
    marginRight: 8,
  },
  rowValueStrong: {
    fontSize: 14,
    color: '#6b7280',
    marginLeft: 8,
    maxWidth: '55%',
  },
  retryText: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '600',
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  userEmail: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  userId: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  updateButton: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c7d2fe',
  },
  updateButtonPressed: {
    backgroundColor: '#eef2ff',
  },
  updateText: {
    color: '#6366f1',
    fontSize: 15,
    fontWeight: '600',
  },
  updateHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginHorizontal: 16,
    marginTop: 8,
    lineHeight: 17,
  },
  signoutButton: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fecaca',
  },
  signoutButtonPressed: {
    backgroundColor: '#fef2f2',
  },
  signoutText: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: '600',
  },
});
