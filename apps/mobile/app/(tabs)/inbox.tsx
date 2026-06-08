import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';

import TaskItem from '@/components/TaskItem';
import QuickAddBar from '@/components/QuickAddBar';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import { getTasksApi } from '@/lib/supabase';
import type { Task } from '@do-done/shared';

export default function InboxScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Task | null>(null);

  const load = useCallback(async () => {
    const api = await getTasksApi();
    const { data } = await api.list({
      status: 'inbox',
      limit: 50,
      offset: 0,
    });
    setTasks(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Completing an inbox task moves it out of the inbox view — drop it instantly.
  const handleOptimisticToggle = useCallback(
    (task: Task, nextCompleted: boolean) => {
      if (nextCompleted) {
        setTasks((prev) => prev.filter((t) => t.id !== task.id));
      }
    },
    []
  );

  // Stable so memoized TaskItem rows don't re-render when `editing` changes.
  const handlePress = useCallback((t: Task) => setEditing(t), []);

  return (
    <View style={styles.container}>
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TaskItem
            task={item}
            onChange={load}
            onPress={handlePress}
            onOptimisticToggle={handleOptimisticToggle}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor="#6366f1" />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Inbox is empty</Text>
              <Text style={styles.emptyHint}>
                Add a task below to get started
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />
      <QuickAddBar defaultStatus="inbox" onCreated={load} />
      <TaskEditModalV2
        task={editing}
        visible={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
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
