import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DraggableFlatList, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import TaskItem from '@/components/TaskItem';
import OverdueSection from '@/components/OverdueSection';
import QuickAddBar from '@/components/QuickAddBar';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import { getTasksApi } from '@/lib/supabase';
import { generateFocusList } from '@do-done/task-engine';
import { isOverdue } from '@do-done/shared';
import type { Task } from '@do-done/shared';
import { PRIORITY_CONFIG } from '@do-done/shared';

export default function TodayScreen() {
  const router = useRouter();
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Task | null>(null);
  const [otherOrder, setOtherOrder] = useState<Task[]>([]);

  const load = useCallback(async () => {
    const api = await getTasksApi();
    const { data } = await api.list({ limit: 100, offset: 0 });
    setAllTasks(data ?? []);
    setLoading(false);
  }, []);

  // Reload whenever the screen regains focus — initial mount, returning from a
  // detail screen, or coming back from the quick-add widget modal — so newly
  // created tasks appear without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const active = allTasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled'
  );
  const overdue = active.filter(isOverdue);
  const overdueIds = new Set(overdue.map((t) => t.id));
  const fresh = active.filter((t) => !overdueIds.has(t.id));
  const focusList = generateFocusList(fresh, 3);
  const focusIds = new Set(focusList.map((t) => t.id));
  const today = new Date().toISOString().split('T')[0];
  const computedOther = fresh.filter((t) => {
    if (focusIds.has(t.id)) return false;
    if (t.when_bucket === 'today') return true;
    const d = t.when_date ?? t.due_date ?? null;
    return d !== null && d <= today;
  });

  useEffect(() => {
    // Keep our drag-reorderable view in sync with the server-derived list
    // whenever the underlying tasks change (e.g. after a mutation).
    setOtherOrder(computedOther);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedOther.map((t) => t.id).join(',')]);

  async function persistOrder(next: Task[]) {
    const api = await getTasksApi();
    await api.bulkUpdate(
      next.map((t, i) => ({ id: t.id, input: { sort_order: (i + 1) * 1000 } }))
    );
    load();
  }

  const renderDraggable = useCallback(
    ({ item, drag, isActive }: RenderItemParams<Task>) => (
      <Pressable
        onLongPress={drag}
        delayLongPress={250}
        style={[
          isActive && { opacity: 0.85, backgroundColor: '#f1f5f9' },
        ]}
      >
        <TaskItem task={item} onChange={load} onPress={(t) => setEditing(t)} />
      </Pressable>
    ),
    [load]
  );

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>Today</Text>
        <Pressable
          onPress={() => router.push('/completed' as never)}
          hitSlop={8}
          style={styles.completedBtn}
        >
          <Ionicons name="checkmark-done-circle" size={22} color="#6366f1" />
        </Pressable>
      </View>

      <DraggableFlatList
        data={otherOrder}
        keyExtractor={(item) => item.id}
        renderItem={renderDraggable}
        onDragEnd={({ data }) => {
          setOtherOrder(data);
          persistOrder(data);
        }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor="#6366f1"
          />
        }
        ListHeaderComponent={
          <View>
            <OverdueSection tasks={overdue} onChange={load} />
            {focusList.length > 0 && (
              <View style={styles.focusSection}>
                <Text style={styles.sectionTitle}>Focus</Text>
                {focusList.map((task) => (
                  <Pressable
                    key={task.id}
                    onPress={() => setEditing(task)}
                    style={({ pressed }) => [
                      styles.focusCard,
                      pressed && styles.focusCardPressed,
                    ]}
                  >
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
                  </Pressable>
                ))}
              </View>
            )}
            {otherOrder.length > 0 && (
              <Text style={[styles.sectionTitle, styles.allTasksTitle]}>
                Other tasks
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading &&
          focusList.length === 0 &&
          overdue.length === 0 &&
          otherOrder.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Nothing scheduled today</Text>
              <Text style={styles.emptyHint}>Add a task below.</Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />
      <QuickAddBar defaultStatus="not_started" onCreated={load} />
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  topTitle: { fontSize: 22, fontWeight: '700', color: '#111827' },
  completedBtn: { padding: 4 },
  listContent: {
    paddingBottom: 140,
    flexGrow: 1,
  },
  focusSection: {
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
    paddingHorizontal: 16,
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
  focusCardPressed: {
    opacity: 0.7,
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
