import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl } from 'react-native';
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Project } from '@do-done/shared';

import { useProjectsWithCounts, reorderProjects } from '@/lib/task-queries';
import { useRefreshOnFocus, usePullToRefresh } from '@/lib/query-client';
import { useListLoadState } from '@/lib/list-load-state';
import { ProjectFormSheet } from '@/components/ProjectFormSheet';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';

type ProjectRow = Project & { task_count: number; open_count: number };

export default function ProjectsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const projectsQuery = useProjectsWithCounts();
  const { data: projects = [], refetch } = projectsQuery;
  const loadState = useListLoadState(projectsQuery);
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  // Local copy so a drag reorders instantly; re-seeded whenever the server list
  // changes (a create, a reconcile after reorder, another device's edit).
  const [ordered, setOrdered] = useState<ProjectRow[]>(projects);
  const [showCreate, setShowCreate] = useState(false);

  const sig = projects.map((p) => `${p.id}:${p.sort_order}`).join(',');
  useEffect(() => {
    setOrdered(projects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const handleDragEnd = ({ data }: { data: ProjectRow[] }) => {
    setOrdered(data); // optimistic
    reorderProjects(data.map((p) => p.id)).catch(() => {
      setOrdered(projects); // rollback to server truth
    });
  };

  const renderItem = ({
    item,
    drag,
    isActive,
  }: RenderItemParams<ProjectRow>) => (
    <ScaleDecorator>
      <Pressable
        onPress={() => router.push(`/projects/${item.id}` as never)}
        onLongPress={drag}
        delayLongPress={180}
        disabled={isActive}
        style={({ pressed }) => [
          styles.projectRow,
          (pressed || isActive) && styles.pressed,
        ]}
      >
        <View style={[styles.colorDot, { backgroundColor: item.color }]} />
        <View style={styles.info}>
          <View style={styles.nameRow}>
            {item.icon ? <Text style={styles.icon}>{item.icon}</Text> : null}
            <Text style={styles.projectName}>{item.name}</Text>
          </View>
          <Text style={styles.taskCount}>
            {item.open_count} open
            {item.task_count > item.open_count
              ? ` · ${item.task_count - item.open_count} done`
              : ''}
          </Text>
        </View>
        {/* Long-press anywhere on the row to drag; this is the visual cue. */}
        <Ionicons name="reorder-three" size={22} color="#d1d5db" />
      </Pressable>
    </ScaleDecorator>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.topTitle}>Projects</Text>
        <View style={styles.topActions}>
          {/* The other way the user's work is grouped. Settings also lists
              Tags, but nobody looks for a browse surface in Settings — this
              is the tab where "show me everything filed under X" lives. */}
          <Pressable
            onPress={() => router.push('/tags' as never)}
            hitSlop={10}
            style={styles.addBtn}
            accessibilityLabel="Tags"
          >
            <Ionicons name="pricetags-outline" size={19} color="#6366f1" />
          </Pressable>
          <Pressable
            onPress={() => setShowCreate(true)}
            hitSlop={10}
            style={styles.addBtn}
            accessibilityLabel="New project"
          >
            <Ionicons name="add" size={24} color="#6366f1" />
          </Pressable>
        </View>
      </View>
      <UpdatingBar visible={loadState.showUpdating} />

      <DraggableFlatList
        data={ordered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onDragEnd={handleDragEnd}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={
          loadState.showSkeleton ? (
            <ListSkeleton rows={4} />
          ) : loadState.showError ? (
            <ListError onRetry={refetch} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No projects yet</Text>
              <Text style={styles.emptyHint}>
                Tap + to create your first project
              </Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
      />

      <ProjectFormSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
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
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2ff',
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 40,
    flexGrow: 1,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  pressed: {
    opacity: 0.7,
    backgroundColor: '#f9fafb',
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 14,
  },
  info: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  icon: {
    fontSize: 15,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  taskCount: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
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
