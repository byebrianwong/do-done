import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import type { Project } from '@do-done/shared';
import { listSubline } from '@do-done/shared';

import { useLists, useListCounts } from '@/lib/list-queries';
import { usePullToRefresh, useRefreshOnFocus } from '@/lib/query-client';
import { useListLoadState } from '@/lib/list-load-state';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import { ProjectFormSheet } from '@/components/ProjectFormSheet';
import { ProjectIcon } from '@/components/ProjectIcon';

export default function ListsScreen() {
  const router = useRouter();
  const listsQuery = useLists();
  const { data: lists = [], refetch } = listsQuery;
  const { data: counts } = useListCounts();
  const loadState = useListLoadState(listsQuery);
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);
  const [showCreate, setShowCreate] = useState(false);

  const renderItem = ({ item }: { item: Project }) => {
    const count = counts?.get(item.id) ?? { open: 0, got: 0 };
    return (
      <Pressable
        onPress={() => router.push(`/lists/${item.id}` as never)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={[styles.ring, { backgroundColor: item.color }]}>
          <ProjectIcon icon={item.icon} size={13} color="#ffffff" />
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{item.name}</Text>
          {/* Shared with web, so "Nothing on it" can't become "0 items" here. */}
          <Text style={styles.sub}>
            {listSubline({ ...count, elsewhere: 0 })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Lists',
          headerRight: () => (
            <Pressable
              onPress={() => setShowCreate(true)}
              hitSlop={10}
              accessibilityLabel="New list"
            >
              <Ionicons name="add" size={24} color="#6366f1" />
            </Pressable>
          ),
        }}
      />
      <UpdatingBar visible={loadState.showUpdating} />

      <FlatList
        data={lists}
        keyExtractor={(item) => item.id}
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
            <ListSkeleton rows={3} />
          ) : loadState.showError ? (
            <ListError onRetry={refetch} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No lists yet</Text>
              <Text style={styles.emptyHint}>
                Groceries, Amazon, the hardware store — things to buy, kept out
                of your tasks.
              </Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
      />

      <ProjectFormSheet
        visible={showCreate}
        kind="list"
        onClose={() => setShowCreate(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  listContent: { paddingTop: 8, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  pressed: { opacity: 0.7 },
  ring: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600', color: '#111827' },
  sub: { fontSize: 12, color: '#6b7280' },
  empty: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#6b7280' },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 19,
  },
});
