import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import TaskItem from '@/components/TaskItem';
import { getTasksApi } from '@/lib/supabase';
import type { Task } from '@do-done/shared';

type Section = { title: string; data: Task[] };

function groupByDay(tasks: Task[]): Section[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 7);

  const buckets = {
    today: [] as Task[],
    yesterday: [] as Task[],
    week: [] as Task[],
    earlier: [] as Task[],
  };
  for (const t of tasks) {
    if (!t.completed_at) {
      buckets.earlier.push(t);
      continue;
    }
    const d = new Date(t.completed_at);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) buckets.today.push(t);
    else if (d.getTime() === yesterday.getTime()) buckets.yesterday.push(t);
    else if (d >= weekStart) buckets.week.push(t);
    else buckets.earlier.push(t);
  }
  const out: Section[] = [];
  if (buckets.today.length) out.push({ title: 'Today', data: buckets.today });
  if (buckets.yesterday.length)
    out.push({ title: 'Yesterday', data: buckets.yesterday });
  if (buckets.week.length) out.push({ title: 'This week', data: buckets.week });
  if (buckets.earlier.length)
    out.push({ title: 'Earlier', data: buckets.earlier });
  return out;
}

export default function CompletedScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const api = await getTasksApi();
    const { data } = await api.listCompleted({ limit: 200 });
    setTasks(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sections = groupByDay(tasks);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Completed' }} />
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TaskItem task={item} onChange={load} />}
        renderSectionHeader={({ section: { title, data } }) => (
          <View style={styles.header}>
            <Text style={styles.headerText}>
              {title} <Text style={styles.headerCount}>({data.length})</Text>
            </Text>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Nothing here yet — complete a task and it’ll land here.
              </Text>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor="#6366f1"
          />
        }
        stickySectionHeadersEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  header: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#6b7280',
  },
  headerCount: { color: '#9ca3af', fontWeight: '500' },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#9ca3af', fontSize: 14, textAlign: 'center' },
});
