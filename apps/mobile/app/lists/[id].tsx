import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  SectionList,
  TextInput,
  RefreshControl,
  Keyboard,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { Aisle, AisleMemory, Task } from '@do-done/shared';
import {
  aisleOptions,
  gotItems,
  groupByAisle,
  itemAisle,
  listSubline,
  openItems,
  summarizeList,
  withAisle,
} from '@do-done/shared';

import {
  addListItem,
  clearGotItems,
  invalidateLists,
  rememberAisle,
  restoreItems,
  useAisleMemory,
  useList,
  useListItems,
} from '@/lib/list-queries';
import { toggleComplete, updateTask } from '@/lib/task-queries';
import { usePullToRefresh, useRefreshOnFocus } from '@/lib/query-client';
import { useListLoadState } from '@/lib/list-load-state';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import { ProjectIcon } from '@/components/ProjectIcon';
import { useUndoToast } from '@/components/UndoToast';
import { hapticLight, hapticMedium } from '@/lib/haptics';

/**
 * A shopping list.
 *
 * Deliberately not `GroupedTaskList`. Every axis that component exists to offer
 * — group by status, sort by deadline, filter by priority — is meaningless on a
 * list of things to buy, and the row it draws spends its width on a project
 * ring and an urgency gutter that a list has no use for. What is left is a
 * checkbox, a word, and a text field that must not lose focus.
 */
export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listId = String(id);
  const { data: list } = useList(listId);
  const itemsQuery = useListItems(listId);
  const { data: items = [], refetch } = itemsQuery;
  const loadState = useListLoadState(itemsQuery);
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);
  // Absent until it loads, and an empty map is the correct fallback: without a
  // memory the lexicon still guesses.
  const { data: memory } = useAisleMemory();

  const [draft, setDraft] = useState('');
  const [added, setAdded] = useState(0);
  const [picking, setPicking] = useState<Task | null>(null);
  const toast = useUndoToast();
  const inputRef = useRef<TextInput>(null);

  const open = useMemo(() => openItems(items), [items]);
  const got = useMemo(() => gotItems(items), [items]);
  const summary = useMemo(() => summarizeList(items), [items]);

  const submit = useCallback(async () => {
    const title = draft.trim();
    if (!title) return;
    // Cleared before the write, never after: the field has to be ready for the
    // next word on the same frame, which is the whole point of a burst
    // composer. `blurOnSubmit={false}` keeps the keyboard up with it.
    setDraft('');
    try {
      await addListItem(listId, { title });
      setAdded((n) => n + 1);
      hapticLight();
    } catch {
      // Give back what they typed rather than losing it to a dropped network.
      setDraft(title);
      toast.show({ message: "Couldn't add that — try again" });
    }
  }, [draft, listId, toast]);

  const onClear = useCallback(async () => {
    try {
      const ids = await clearGotItems(listId);
      if (ids.length === 0) return;
      toast.show({
        message: `Cleared ${ids.length} item${ids.length === 1 ? '' : 's'}`,
        undo: async () => {
          await restoreItems(listId, ids);
        },
      });
    } catch {
      toast.show({ message: "Couldn't clear the list" });
    }
  }, [listId, toast]);

  const sections = useMemo(() => {
    // Aisle groups in walking order. `groupByAisle` collapses to one unlabelled
    // group when grouping would gain nothing, which is what makes a short list
    // — or one full of words the lexicon doesn't know — look like the plain
    // list it always was rather than a broken grouped one.
    const aisles = groupByAisle(open, { memory }).map((g) => ({
      title: g.label,
      data: g.items,
    }));
    return [
      ...aisles,
      // The bought pile keeps its own heading and its count, so a mis-tick
      // while walking is one glance from being found. Never grouped: it is a
      // record of what happened, not a route through anything.
      ...(got.length > 0
        ? [{ title: `Got it · ${got.length}`, data: got }]
        : []),
    ].filter((s) => s.data.length > 0);
  }, [open, got, memory]);

  /**
   * Move an item to a different aisle.
   *
   * Written as a tag rather than inferred again, so the correction survives
   * every future render *and* every future change to the lexicon: the shelf
   * the user is standing at outranks our guess about the word, permanently.
   */
  const writeAisle = useCallback(
    async (item: Task, aisle: Aisle | null) => {
      setPicking(null);
      try {
        await updateTask(item.id, { tags: withAisle(item.tags, aisle) });
        // The tag fixes this row; the lesson fixes the same words next week,
        // after this item has been cleared and purged. Best-effort, so a
        // failed lesson never undoes a visible fix.
        await rememberAisle(item.title, aisle);
        invalidateLists(listId);
      } catch {
        toast.show({ message: "Couldn't move that item" });
      }
    },
    [listId, toast]
  );

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: list?.name ?? 'List',
          headerLeft: list
            ? () => (
                <View style={[styles.ring, { backgroundColor: list.color }]}>
                  <ProjectIcon icon={list.icon} size={12} color="#ffffff" />
                </View>
              )
            : undefined,
          headerRight:
            got.length > 0
              ? () => (
                  <Pressable onPress={onClear} hitSlop={10}>
                    <Text style={styles.clear}>Clear bought</Text>
                  </Pressable>
                )
              : undefined,
        }}
      />
      <UpdatingBar visible={loadState.showUpdating} />

      <View style={styles.composer}>
        <Ionicons name="add" size={20} color="#6366f1" />
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          // The two props that make this a burst rather than one item: the
          // keyboard stays up, and return commits instead of dismissing.
          blurOnSubmit={false}
          returnKeyType="done"
          submitBehavior="submit"
          placeholder="Add an item"
          placeholderTextColor="#9ca3af"
          style={styles.input}
        />
        {added > 0 && <Text style={styles.added}>{added} added</Text>}
      </View>

      <Text style={styles.subline}>{listSubline(summary)}</Text>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        // Tapping a row while typing must tick it, not just dismiss the
        // keyboard and swallow the tap.
        // An empty title is the ungrouped case — `groupByAisle` collapses to
        // one unlabelled group when grouping would gain nothing, and that has
        // to render as a plain list with no header at all.
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <ItemRow item={item} onLongPress={() => setPicking(item)} />
        )}
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
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Nothing on this list</Text>
              <Text style={styles.emptyHint}>
                Type above, or add from anywhere with #
                {(list?.name ?? '').toLowerCase().replace(/\s+/g, '')}
              </Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
        onScrollBeginDrag={() => Keyboard.dismiss()}
      />

      <AislePicker
        item={picking}
        memory={memory}
        onPick={writeAisle}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

/**
 * Correcting an item's aisle.
 *
 * Behind a long-press rather than a control on the row: the row's one job is
 * to be tapped while walking, and a second target competing for that surface
 * would cost mis-ticks. Fixing an aisle is rare, deliberate and usually done
 * sitting down, so it can afford to be hidden behind a gesture.
 *
 * A `Modal` is fine here where it isn't in the quick-add composer — nothing on
 * this screen is keyboard-anchored at the moment a row is long-pressed, so
 * there is no IME for a second window to drop.
 */
function AislePicker({
  item,
  memory,
  onPick,
  onClose,
}: {
  item: Task | null;
  /** So the tick sits on the aisle the row is actually filed under. */
  memory?: AisleMemory;
  onPick: (item: Task, aisle: Aisle | null) => void;
  onClose: () => void;
}) {
  if (!item) return null;
  const current = itemAisle(item, memory);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <ScrollView bounces={false}>
            {aisleOptions().map((option) => (
              <Pressable
                key={option.value}
                onPress={() => onPick(item, option.value)}
                style={({ pressed }) => [
                  styles.option,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.optionText}>{option.label}</Text>
                {current === option.value && (
                  <Ionicons name="checkmark" size={17} color="#6366f1" />
                )}
              </Pressable>
            ))}
            {/* "Automatic", not "Other": clearing hands the word back to the
                lexicon, which usually has an opinion — so the row does not
                land in Other, and a label saying it would be a lie. */}
            <Pressable
              onPress={() => onPick(item, null)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text style={[styles.optionText, styles.optionMuted]}>
                Automatic
              </Text>
              {current === null && (
                <Ionicons name="checkmark" size={17} color="#6366f1" />
              )}
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ItemRow({
  item,
  onLongPress,
}: {
  item: Task;
  onLongPress: () => void;
}) {
  const done = item.status === 'done' || item.status === 'cancelled';
  return (
    <Pressable
      onPress={() => {
        hapticLight();
        void toggleComplete(item.id, !done);
      }}
      onLongPress={() => {
        hapticMedium();
        onLongPress();
      }}
      delayLongPress={300}
      style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
    >
      <View style={[styles.box, done && styles.boxDone]}>
        {done && <Ionicons name="checkmark" size={13} color="#ffffff" />}
      </View>
      <Text style={[styles.itemText, done && styles.itemTextDone]}>
        {item.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  ring: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  clear: { fontSize: 13, fontWeight: '600', color: '#6366f1' },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  input: { flex: 1, fontSize: 15, color: '#111827', padding: 0 },
  added: { fontSize: 11, color: '#9ca3af', fontVariant: ['tabular-nums'] },
  subline: {
    fontSize: 12,
    color: '#6b7280',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 2,
  },
  listContent: { paddingTop: 4, paddingBottom: 40 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 6,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 14,
    // Roomier than a task row on purpose: this one gets tapped while walking.
    paddingVertical: 13,
    borderRadius: 10,
  },
  pressed: { opacity: 0.65 },
  box: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxDone: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  itemText: { flex: 1, fontSize: 15, color: '#111827' },
  itemTextDone: { color: '#9ca3af', textDecorationLine: 'line-through' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 14,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    paddingHorizontal: 20,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  optionText: { fontSize: 15, color: '#111827' },
  optionMuted: { color: '#6b7280' },
  empty: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#6b7280' },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 19,
  },
});
