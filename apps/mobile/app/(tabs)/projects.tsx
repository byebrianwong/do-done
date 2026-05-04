import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  RefreshControl,
} from 'react-native';

import { getProjectsApi } from '@/lib/supabase';
import type { Project } from '@do-done/shared';

type ProjectWithCounts = Project & { task_count: number; open_count: number };

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<ProjectWithCounts[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const api = await getProjectsApi();
    const { data } = await api.listWithCounts();
    setProjects(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.projectRow,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.colorDot, { backgroundColor: item.color }]} />
            <View style={styles.info}>
              <View style={styles.nameRow}>
                {item.icon ? (
                  <Text style={styles.icon}>{item.icon}</Text>
                ) : null}
                <Text style={styles.projectName}>{item.name}</Text>
              </View>
              <Text style={styles.taskCount}>
                {item.open_count} open
                {item.task_count > item.open_count
                  ? ` · ${item.task_count - item.open_count} done`
                  : ''}
              </Text>
            </View>
          </Pressable>
        )}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No projects yet</Text>
              <Text style={styles.emptyHint}>
                Create projects on the web app
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
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
