import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View, Text, StyleSheet, RefreshControl } from 'react-native';
import DraggableFlatList, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TaskItem from '@/components/TaskItem';
import QuickAddBar from '@/components/QuickAddBar';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import { invalidateTasks, reorderTasks, useInboxTasks } from '@/lib/task-queries';
import { useRefreshOnFocus } from '@/lib/query-client';
import type { Task } from '@do-done/shared';

export default function InboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: tasks = [], isLoading, isRefetching, refetch } = useInboxTasks();
  const [order, setOrder] = useState<Task[]>([]);
  const [editing, setEditing] = useState<Task | null>(null);

  useRefreshOnFocus(refetch);

  // Mirror the server-derived list into a drag-reorderable copy.
  useEffect(() => {
    setOrder(tasks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.map((t) => t.id).join(',')]);

  function persistOrder(next: Task[]) {
    setOrder(next);
    void reorderTasks(next.map((t) => t.id)).catch(() => {});
  }

  const handlePress = useCallback((t: Task) => setEditing(t), []);

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<Task>) => (
      <View style={isActive ? styles.activeRow : undefined}>
        <TaskItem task={item} onPress={handlePress} onDragHandle={drag} />
      </View>
    ),
    [handlePress]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.topTitle}>Inbox</Text>
        <View style={styles.topActions}>
          <Pressable
            onPress={() => router.push('/search' as never)}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Ionicons name="search" size={22} color="#6366f1" />
          </Pressable>
        </View>
      </View>

      <DraggableFlatList
        data={order}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onDragEnd={({ data }) => persistOrder(data)}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={
          !isLoading ? (
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
      <QuickAddBar defaultStatus="inbox" onCreated={invalidateTasks} />
      <TaskEditModalV2
        task={editing}
        visible={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={invalidateTasks}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  topTitle: { fontSize: 22, fontWeight: '700', color: '#111827' },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 4 },
  activeRow: { opacity: 0.9, backgroundColor: '#f1f5f9' },
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
