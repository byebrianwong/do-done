import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';

import TaskItem, { Task } from '@/components/TaskItem';
import QuickAddBar from '@/components/QuickAddBar';

const MOCK_TASKS: Task[] = [
  {
    id: '1',
    title: 'Review PR for auth module',
    status: 'active',
    priority: 'urgent',
    due_date: 'Today',
    project_id: 'proj-1',
  },
  {
    id: '2',
    title: 'Write unit tests for task engine',
    status: 'active',
    priority: 'high',
    due_date: 'Today',
    project_id: 'proj-1',
  },
  {
    id: '3',
    title: 'Update design tokens in shared package',
    status: 'active',
    priority: 'medium',
    due_date: 'Today',
    project_id: 'proj-2',
  },
  {
    id: '4',
    title: 'Set up CI pipeline for mobile builds',
    status: 'active',
    priority: 'low',
    due_date: 'Tomorrow',
    project_id: 'proj-3',
  },
  {
    id: '5',
    title: 'Draft product roadmap for Q3',
    status: 'active',
    priority: 'medium',
    due_date: 'Apr 15',
  },
];

const FOCUS_TASKS = MOCK_TASKS.slice(0, 3);

export default function TodayScreen() {
  return (
    <View style={styles.container}>
      <FlatList
        data={MOCK_TASKS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TaskItem task={item} />}
        ListHeaderComponent={
          <View style={styles.focusSection}>
            <Text style={styles.sectionTitle}>Focus</Text>
            {FOCUS_TASKS.map((task) => (
              <View key={task.id} style={styles.focusCard}>
                <View
                  style={[
                    styles.focusDot,
                    {
                      backgroundColor:
                        task.priority === 'urgent'
                          ? '#ef4444'
                          : task.priority === 'high'
                            ? '#f97316'
                            : '#eab308',
                    },
                  ]}
                />
                <Text style={styles.focusTitle} numberOfLines={1}>
                  {task.title}
                </Text>
              </View>
            ))}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
              All Tasks
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
      <QuickAddBar />
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
  },
  focusSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
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
});
