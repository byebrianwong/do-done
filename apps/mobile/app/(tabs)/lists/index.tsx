import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Project } from '@do-done/shared';
import { listSubline } from '@do-done/shared';

import { useLists, useListCounts } from '@/lib/list-queries';
import { usePullToRefresh, useRefreshOnFocus } from '@/lib/query-client';
import { useListLoadState } from '@/lib/list-load-state';
import {
  hasResumeTried,
  loadResume,
  markResumeTried,
  resumeDecision,
  saveResume,
} from '@/lib/tab-resume';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import { ProjectFormSheet } from '@/components/ProjectFormSheet';
import { ProjectIcon } from '@/components/ProjectIcon';

export default function ListsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listsQuery = useLists();
  const { data: lists, refetch } = listsQuery;
  const { data: counts } = useListCounts();
  const loadState = useListLoadState(listsQuery);
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);
  const [showCreate, setShowCreate] = useState(false);
  const [remembered, setRemembered] = useState<string | null | undefined>(
    undefined
  );
  // Only the focused index may decide. A row tapped by hand blurs this screen
  // while the ids may still be arriving, and an ungated decision would then
  // push a second detail on top of the one the user just opened.
  const [focused, setFocused] = useState(false);

  // Re-read on every focus rather than once at mount: the detail screen writes
  // the memory, so a value read at mount is stale the moment we come back.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setFocused(true);
      loadResume('lists')
        .then((id) => {
          if (!cancelled) setRemembered(id);
        })
        .catch(() => {
          if (!cancelled) setRemembered(null);
        });
      return () => {
        cancelled = true;
        setFocused(false);
      };
    }, [])
  );

  // The tab opens on the list you were last in. What to do is a pure function
  // so the node suite can cover it — see `lib/tab-resume.ts`.
  useEffect(() => {
    if (!focused || remembered === undefined) return;
    const decision = resumeDecision({
      remembered,
      known: lists ? lists.map((l) => l.id) : null,
      alreadyTried: hasResumeTried('lists'),
    });
    if (decision.action === 'wait') return;
    markResumeTried('lists');
    if (decision.action === 'open') {
      router.push(`/lists/${decision.id}` as never);
      // Unknown again until the next focus re-reads it: a refetch landing
      // while the detail is up would otherwise re-decide, see `alreadyTried`,
      // and wipe the memory that detail has just written.
      setRemembered(undefined);
    } else if (decision.action === 'forget') {
      // Backing out to the index is itself a visit, so the index becomes what
      // this tab opens on next time.
      setRemembered(null);
      saveResume('lists', null);
    }
  }, [focused, remembered, lists, router]);

  const renderItem = ({ item }: { item: Project }) => {
    const count = counts?.get(item.id) ?? { open: 0, got: 0 };
    return (
      <Pressable
        onPress={() => {
          // Opening one by hand spends the restore's turn. Without this, an
          // account whose lists hadn't loaded yet would still be holding an
          // unused restore, and popping back here would bounce straight into
          // the list the user had just left.
          markResumeTried('lists');
          router.push(`/lists/${item.id}` as never);
        }}
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
      {/* An in-content bar rather than the stack's native header: this is a
          tab root now, and it has to match the three beside it. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.topTitle}>Lists</Text>
        <Pressable
          onPress={() => setShowCreate(true)}
          hitSlop={10}
          style={styles.addBtn}
          accessibilityLabel="New list"
        >
          <Ionicons name="add" size={24} color="#6366f1" />
        </Pressable>
      </View>
      <UpdatingBar visible={loadState.showUpdating} />

      <FlatList
        data={lists ?? []}
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  topTitle: { fontSize: 22, fontWeight: '700', color: '#111827' },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2ff',
  },
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
