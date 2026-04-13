import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';

interface Project {
  id: string;
  name: string;
  color: string;
  taskCount: number;
}

const MOCK_PROJECTS: Project[] = [
  { id: 'proj-1', name: 'Do-Done App', color: '#6366f1', taskCount: 12 },
  { id: 'proj-2', name: 'Design System', color: '#ec4899', taskCount: 7 },
  { id: 'proj-3', name: 'Infrastructure', color: '#14b8a6', taskCount: 4 },
];

export default function ProjectsScreen() {
  return (
    <View style={styles.container}>
      <FlatList
        data={MOCK_PROJECTS}
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
              <Text style={styles.projectName}>{item.name}</Text>
              <Text style={styles.taskCount}>
                {item.taskCount} {item.taskCount === 1 ? 'task' : 'tasks'}
              </Text>
            </View>
          </Pressable>
        )}
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
});
