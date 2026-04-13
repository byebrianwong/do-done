import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';

import TaskItem, { Task } from '@/components/TaskItem';

const INBOX_TASKS: Task[] = [
  {
    id: 'inbox-1',
    title: 'Look into crash reports from last release',
    status: 'inbox',
    priority: 'high',
  },
  {
    id: 'inbox-2',
    title: 'Schedule 1:1 with design lead',
    status: 'inbox',
    priority: 'medium',
  },
  {
    id: 'inbox-3',
    title: 'Read article on React Server Components',
    status: 'inbox',
    priority: 'low',
  },
  {
    id: 'inbox-4',
    title: 'Reply to feedback email from beta testers',
    status: 'inbox',
    priority: 'medium',
  },
];

export default function InboxScreen() {
  return (
    <View style={styles.container}>
      <FlatList
        data={INBOX_TASKS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TaskItem task={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Inbox is empty</Text>
          </View>
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
    paddingBottom: 40,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#9ca3af',
  },
});
