import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';

import TaskItem from '@/components/TaskItem';
import QuickAddBar from '@/components/QuickAddBar';
import TaskEditModal from '@/components/TaskEditModal';
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

  return (
    <View style={styles.container}>
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TaskItem
            task={item}
            onChange={load}
            onPress={(t) => setEditing(t)}
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
      <TaskEditModal
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
