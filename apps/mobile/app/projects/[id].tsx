import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';

import QuickAddButton from '@/components/QuickAddButton';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import DisplaySheet from '@/components/DisplaySheet';
import GroupedTaskList from '@/components/GroupedTaskList';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import {
  invalidateTasks,
  useProject,
  useProjectsWithCounts,
  useProjectTasks,
} from '@/lib/task-queries';
import { useRefreshOnFocus, usePullToRefresh } from '@/lib/query-client';
import { useDisplayConfig } from '@/lib/use-display-config';
import { useListLoadState } from '@/lib/list-load-state';
import type { Task } from '@do-done/shared';
import { ProjectIcon } from '@/components/ProjectIcon';

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = id ?? '';

  const { data: project } = useProject(projectId);
  const tasksQuery = useProjectTasks(projectId);
  const { data: tasks = [], refetch } = tasksQuery;
  const loadState = useListLoadState(tasksQuery);
  const { data: projectsWithCounts = [] } = useProjectsWithCounts();
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const [editing, setEditing] = useState<Task | null>(null);
  const [showDisplay, setShowDisplay] = useState(false);
  const { config, setConfig, reset, isDefault } = useDisplayConfig('project');
  const handlePress = useCallback((t: Task) => setEditing(t), []);

  const projectList = useMemo(
    () => projectsWithCounts.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    [projectsWithCounts]
  );

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) for (const tag of t.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  // The whole project is on this screen, so "is this the last one" is just the
  // count of everything still open in it.
  const openInProject = useMemo(
    () =>
      tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
        .length,
    [tasks]
  );

  const title = project?.name ?? 'Project';

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title,
          headerTitle: () => (
            <View style={styles.headerTitle}>
              {project?.icon ? (
                <ProjectIcon icon={project.icon} size={17} color={project.color} />
              ) : project ? (
                <View
                  style={[styles.headerDot, { backgroundColor: project.color }]}
                />
              ) : null}
              <Text style={styles.headerText}>{title}</Text>
            </View>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => setShowDisplay(true)}
              hitSlop={8}
              style={styles.iconBtn}
            >
              <Ionicons name="options-outline" size={22} color="#6366f1" />
              {!isDefault ? <View style={styles.activeDot} /> : null}
            </Pressable>
          ),
        }}
      />
      <UpdatingBar visible={loadState.showUpdating} />
      <GroupedTaskList
        tasks={tasks}
        projects={projectList}
        config={config}
        onConfigChange={setConfig}
        onTaskPress={handlePress}
        // Every row here belongs to the project in the title bar, so the
        // subline saying so on all of them would be pure repetition — and the
        // project's remaining work is the one count that answers both
        // celebration rules on this screen.
        hideProject
        hideEmptyGroups
        openInProject={openInProject}
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
              <Text style={styles.emptyText}>No tasks in this project yet</Text>
              <Text style={styles.emptyHint}>Tap + to add one.</Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
      />
      <QuickAddButton defaultStatus="not_started" projectId={projectId} />
      <DisplaySheet
        visible={showDisplay}
        onClose={() => setShowDisplay(false)}
        config={config}
        onChange={setConfig}
        onReset={reset}
        isDefault={isDefault}
        projects={projectList}
        availableTags={availableTags}
      />
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
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIcon: { fontSize: 16 },
  headerDot: { width: 12, height: 12, borderRadius: 6 },
  headerText: { fontSize: 17, fontWeight: '700', color: '#111827' },
  listContent: { paddingBottom: 96, flexGrow: 1 },
  iconBtn: { padding: 4 },
  activeDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#6366f1',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { fontSize: 16, color: '#6b7280', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#9ca3af', marginTop: 4 },
});
