import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TaskItem from '@/components/TaskItem';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import { invalidateTasks, useSearchTasks } from '@/lib/task-queries';
import type { Task } from '@do-done/shared';

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [raw, setRaw] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);

  // Debounce keystrokes so we don't fire a query on every character.
  useEffect(() => {
    const t = setTimeout(() => setQuery(raw), 220);
    return () => clearTimeout(t);
  }, [raw]);

  // Focus the field on mount.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  const { data: results = [], isFetching } = useSearchTasks(query);
  const handlePress = useCallback((t: Task) => setEditing(t), []);
  const trimmed = query.trim();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#6366f1" />
        </Pressable>
        <View style={styles.inputWrap}>
          <Ionicons name="search" size={18} color="#9ca3af" />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search tasks…"
            placeholderTextColor="#9ca3af"
            value={raw}
            onChangeText={setRaw}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {isFetching ? <ActivityIndicator size="small" color="#6366f1" /> : null}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <TaskItem task={item} onPress={handlePress} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {trimmed.length === 0
                ? 'Search across every task'
                : isFetching
                  ? 'Searching…'
                  : `No tasks match “${trimmed}”`}
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
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
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  backBtn: { padding: 2 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: { flex: 1, fontSize: 16, color: '#111827', padding: 0 },
  listContent: { paddingBottom: 40, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 100 },
  emptyText: { fontSize: 14, color: '#9ca3af', textAlign: 'center', paddingHorizontal: 32 },
});
