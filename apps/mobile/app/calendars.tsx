/**
 * Which Google calendars appear inside DoDone.
 *
 * The stored preference is the set of calendars switched OFF, so a calendar
 * created in Google after the last save shows up here already on — the case
 * this screen exists for. Selection is shared with the web settings page
 * (same `user_preferences.hidden_calendar_ids`), and the cap is a limit on
 * what's ticked, not a silent truncation of Google's list.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import {
  MAX_DISPLAY_CALENDARS,
  isCalendarVisible,
  toHiddenIds,
} from '@do-done/shared';
import { getUserPrefsApi } from '@/lib/supabase';
import { queryClient } from '@/lib/query-client';
import {
  CalendarNotConnectedError,
  calendarKeys,
  useCalendarList,
} from '@/lib/calendar-queries';

export default function CalendarsScreen() {
  const { data, isLoading, error, refetch } = useCalendarList();
  const calendars = useMemo(() => data?.calendars ?? [], [data]);

  // null until the list arrives — the ticks are derived from it, either from
  // the stored exclusion set or (first visit) Google's own visible flags.
  const [visibleIds, setVisibleIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    setVisibleIds(
      new Set(
        data.calendars
          .filter((c) => isCalendarVisible(c, data.hidden))
          .map((c) => c.id)
      )
    );
  }, [data]);

  const count = visibleIds?.size ?? 0;
  const atLimit = count >= MAX_DISPLAY_CALENDARS;
  // Only reachable from the first-visit defaults: Google can have more ticked
  // than DoDone will load.
  const overLimit = Math.max(0, count - MAX_DISPLAY_CALENDARS);
  const dropped = useMemo(() => {
    if (!visibleIds || overLimit === 0) return [];
    return calendars
      .filter((c) => visibleIds.has(c.id))
      .slice(MAX_DISPLAY_CALENDARS)
      .map((c) => c.summary);
  }, [calendars, visibleIds, overLimit]);

  async function toggle(id: string, next: boolean) {
    if (!visibleIds) return;
    if (next && visibleIds.size >= MAX_DISPLAY_CALENDARS) return;
    const updated = new Set(visibleIds);
    if (next) updated.add(id);
    else updated.delete(id);

    const previous = visibleIds;
    setVisibleIds(updated); // optimistic
    try {
      const api = await getUserPrefsApi();
      const { error: saveError } = await api.updateHiddenCalendars(
        toHiddenIds(
          calendars.map((c) => c.id),
          updated
        )
      );
      if (saveError) throw saveError;
      // The event lists are filtered server-side by this preference.
      void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
    } catch {
      setVisibleIds(previous);
      Alert.alert('Could not save', 'Check your connection and try again.');
    }
  }

  const notConnected = error instanceof CalendarNotConnectedError;

  return (
    <>
      <Stack.Screen options={{ title: 'Calendars to show' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {notConnected ? (
          <Message
            icon="calendar-outline"
            title="Calendar not connected"
            body="Connect Google Calendar from the DoDone web app. Once it's connected, your calendars will be listed here."
          />
        ) : isLoading || !visibleIds ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#6366f1" />
          </View>
        ) : error ? (
          <Message
            icon="alert-circle-outline"
            title="Couldn't load your calendars"
            body="Check your connection and try again."
            action={{ label: 'Retry', onPress: () => void refetch() }}
          />
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={styles.headerText}>
                Events from these calendars appear in Today and Upcoming.
              </Text>
              <Text style={styles.countText}>
                {count} of {MAX_DISPLAY_CALENDARS}
              </Text>
            </View>

            <View style={styles.section}>
              {calendars.map((c) => {
                const checked = visibleIds.has(c.id);
                // At the cap the only useful tap is unticking — leave the
                // rest inert rather than swallowing the tap silently.
                const locked = !checked && atLimit;
                return (
                  <Pressable
                    key={c.id}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && !locked && styles.rowPressed,
                      locked && styles.rowLocked,
                    ]}
                    onPress={() => void toggle(c.id, !checked)}
                    disabled={locked}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled: locked }}
                    accessibilityLabel={c.summary}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={checked ? '#6366f1' : '#c7cbd1'}
                    />
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: c.color ?? '#9ca3af' },
                      ]}
                    />
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {c.summary}
                    </Text>
                    {c.primary ? (
                      <Text style={styles.badge}>primary</Text>
                    ) : !c.canWrite ? (
                      <Text style={styles.badge}>read-only</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            {overLimit > 0 ? (
              <Text style={styles.warning}>
                {overLimit} over the limit — {dropped.slice(0, 3).join(', ')}
                {dropped.length > 3 ? ` and ${dropped.length - 3} more` : ''}{' '}
                {overLimit === 1 ? "isn't" : "aren't"} being loaded. Untick{' '}
                {overLimit} to choose which.
              </Text>
            ) : (
              <Text style={styles.footnote}>
                New calendars show up here automatically. A calendar you create
                in Google appears in DoDone without being switched on
                {atLimit ? ' — untick one first to make room.' : '.'}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function Message({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.centered}>
      <Ionicons name={icon} size={40} color="#d1d5db" />
      <Text style={styles.messageTitle}>{title}</Text>
      <Text style={styles.messageBody}>{body}</Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text style={styles.retryText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40 },
  centered: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 24 },
  messageTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  messageBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#6b7280',
    textAlign: 'center',
  },
  retryText: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginBottom: 10,
  },
  headerText: { flex: 1, fontSize: 13, lineHeight: 18, color: '#6b7280' },
  countText: {
    fontSize: 12,
    color: '#9ca3af',
    fontVariant: ['tabular-nums'],
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  rowPressed: { backgroundColor: '#f9fafb' },
  rowLocked: { opacity: 0.4 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  rowLabel: { flex: 1, fontSize: 15, color: '#111827' },
  badge: { fontSize: 11, color: '#9ca3af' },
  warning: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: '#b45309',
  },
  footnote: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: '#9ca3af',
  },
});
