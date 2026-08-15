import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { encodeTagParam, type TagSummary } from '@do-done/shared';

import { useTags } from '@/lib/task-queries';
import { useRefreshOnFocus, usePullToRefresh } from '@/lib/query-client';
import { useListLoadState } from '@/lib/list-load-state';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';

/**
 * The tags index.
 *
 * A tag is not a row in any table — it exists only while some task carries it
 * — so this screen is counts over the whole task list, fetched as such
 * (`useTags`) rather than derived from whatever a tab happens to hold.
 *
 * A row leads with its open count because that is the number being shopped
 * for; a tag whose work is all finished says so in words rather than showing
 * a bare 0 that reads like a bug.
 */
export default function TagsScreen() {
  const router = useRouter();
  const tagsQuery = useTags();
  const { data: tags = [], refetch } = tagsQuery;
  const loadState = useListLoadState(tagsQuery);
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const [query, setQuery] = useState('');

  // Tags are cheap to mint — a typo in the quick-add makes one — so this
  // list gets long in a way the project list never does, and scrolling it is
  // not a way to find "the one about invoices".
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tags.filter((t) => t.tag.toLowerCase().includes(q)) : tags;
  }, [tags, query]);

  const renderItem = ({ item }: { item: TagSummary }) => (
    <Pressable
      onPress={() => router.push(`/tags/${encodeTagParam(item.tag)}` as never)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.hashBadge}>
        <Text style={styles.hash}>#</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.tagName} numberOfLines={1}>
          {item.tag}
        </Text>
        <Text style={styles.counts}>
          {item.open_count > 0
            ? `${item.open_count} open${
                item.task_count > item.open_count
                  ? ` · ${item.task_count - item.open_count} done`
                  : ''
              }`
            : `All done · ${item.task_count} ${
                item.task_count === 1 ? 'task' : 'tasks'
              }`}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Tags' }} />
      <UpdatingBar visible={loadState.showUpdating} />

      {tags.length > 6 ? (
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color="#9ca3af" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter tags"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
        </View>
      ) : null}

      <FlatList
        data={shown}
        keyExtractor={(t) => t.tag}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={
          loadState.showSkeleton ? (
            <ListSkeleton rows={5} />
          ) : loadState.showError ? (
            <ListError onRetry={refetch} />
          ) : query.trim() ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No tag matches</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No tags yet</Text>
              <Text style={styles.emptyHint}>
                Type #errand in a task title, or add one in the editor.
              </Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  searchInput: { flex: 1, fontSize: 15, color: '#111827' },
  listContent: { padding: 12, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  pressed: { opacity: 0.7 },
  hashBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2ff',
  },
  hash: { fontSize: 15, fontWeight: '700', color: '#6366f1' },
  info: { flex: 1 },
  tagName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  counts: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: { fontSize: 16, color: '#6b7280', fontWeight: '600' },
  emptyHint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
