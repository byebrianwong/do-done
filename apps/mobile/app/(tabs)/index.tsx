import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';

import TaskItem from '@/components/TaskItem';
import QuickAddBar from '@/components/QuickAddBar';
import { getTasksApi } from '@/lib/supabase';
import { generateFocusList } from '@do-done/task-engine';
import type { Task } from '@do-done/shared';
import { PRIORITY_CONFIG } from '@do-done/shared';

export default function TodayScreen() {
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const api = await getTasksApi();
    const { data } = await api.list({ limit: 100, offset: 0 });
    setAllTasks(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = allTasks.filter(
    (t) => t.status !== 'done' && t.status !== 'archived'
  );
  const focusList = generateFocusList(active, 3);
  const focusIds = new Set(focusList.map((t) => t.id));
  const today = new Date().toISOString().split('T')[0];
  const otherToday = active.filter(
    (t) => !focusIds.has(t.id) && t.due_date && t.due_date <= today
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={otherToday}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TaskItem task={item} onChange={load} />
        )}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor="#6366f1" />
        }
        ListHeaderComponent={
          <View style={styles.headerWrapper}>
            {focusList.length > 0 && (
              <View style={styles.focusSection}>
                <Text style={styles.sectionTitle}>Focus</Text>
                {focusList.map((task) => (
                  <View key={task.id} style={styles.focusCard}>
                    <View
                      style={[
                        styles.focusDot,
                        {
                          backgroundColor:
                            PRIORITY_CONFIG[task.priority].color,
                        },
                      ]}
                    />
                    <Text style={styles.focusTitle} numberOfLines={1}>
                      {task.title}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {otherToday.length > 0 && (
              <Text style={[styles.sectionTitle, styles.allTasksTitle]}>
                Other tasks
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading && focusList.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Nothing scheduled today</Text>
              <Text style={styles.emptyHint}>Add a task below.</Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />
      <QuickAddBar defaultStatus="todo" onCreated={load} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  listContent: {
    paddingBottom: 140,
    flexGrow: 1,
  },
  headerWrapper: {
    padding: 16,
  },
  focusSection: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  allTasksTitle: {
    marginTop: 12,
  },
  focusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  focusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  focusTitle: {
    fontSize: 15,
    color: '#1f2937',
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
  },
});
