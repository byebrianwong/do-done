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
import {
  ComposerActionGlyph,
  GLYPH_CLEARANCE,
  GLYPH_PAD,
} from '../../../components/ComposerActionGlyph';
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import type {
  Aisle,
  AisleMemory,
  PantryBand,
  PantryEntry,
  Task,
} from '@do-done/shared';
import {
  aisleOptions,
  gotItems,
  groupByAisle,
  itemAisle,
  itemSubline,
  listSubline,
  openItems,
  storeHint,
  storeSuggestions,
  storeTag,
  storesOnList,
  summarizeList,
  typingStoreToken,
  applyStoreToken,
  extractStoreToken,
  withAisle,
  withStoreHint,
  lastBoughtLabel,
  pantryBands,
  searchPantry,
  cadenceLabel,
  dueEntries,
} from '@do-done/shared';

import {
  addListItem,
  clearGotItems,
  forgetPantryEntry,
  invalidateLists,
  invalidatePantry,
  rememberAisle,
  restoreItems,
  useAisleMemory,
  useList,
  useListItems,
  usePantry,
} from '@/lib/list-queries';
import { toggleComplete, updateTask } from '@/lib/task-queries';
import { usePullToRefresh, useRefreshOnFocus } from '@/lib/query-client';
import { useTabBarScrollSync } from '@/lib/tab-bar-minimize';
import { saveResume } from '@/lib/tab-resume';
import { useListLoadState } from '@/lib/list-load-state';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import { ProjectIcon } from '@/components/ProjectIcon';
import { ProjectFormSheet } from '@/components/ProjectFormSheet';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
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
  // The items list drives the minimizing tab bar and reserves its height.
  const tabBar = useTabBarScrollSync();
  // Absent until it loads, and an empty map is the correct fallback: without a
  // memory the lexicon still guesses.
  const { data: memory } = useAisleMemory();
  // Everything ever bought on this list. Empty until it loads, which is the
  // correct fallback: the screen is then a plain shopping list, which is what
  // it was before this existed.
  const { data: pantry = [] } = usePantry(listId);

  // What the Lists tab opens on next time. Written while you are looking at
  // the list rather than when you leave it, so a kill from here still counts.
  useFocusEffect(
    useCallback(() => {
      saveResume('lists', listId);
    }, [listId])
  );

  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [added, setAdded] = useState(0);
  // What moves the action glyph to the trailing edge. Text counts as well
  // as focus: a half-typed item the keyboard has been dismissed over still
  // has something to commit.
  const [composerFocused, setComposerFocused] = useState(false);
  // The glyph travels the field's width, so the field has to report it.
  const [composerWidth, setComposerWidth] = useState(0);
  const [picking, setPicking] = useState<Task | null>(null);
  /** The item whose editor is up. An item is a task, so it is the same sheet. */
  const [editing, setEditing] = useState<Task | null>(null);
  /** The list's own name / icon / colour form. */
  const [editingList, setEditingList] = useState(false);
  const toast = useUndoToast();
  const inputRef = useRef<TextInput>(null);

  const open = useMemo(() => openItems(items), [items]);
  const got = useMemo(() => gotItems(items), [items]);
  const summary = useMemo(() => summarizeList(items), [items]);
  // Every store already named on this list, most-used first. Bought items
  // count too: the cart holds last week's stores, and dropping them on a tick
  // would empty the suggestions when they are most useful.
  const stores = useMemo(() => storesOnList(items), [items]);
  // What the composer is typing after an `@`, or null if no token is open. An
  // empty string is a real answer: a bare `@` opens the full list.
  const storeQuery = typingStoreToken(draft);
  const storeMatches = useMemo(
    () => (storeQuery === null ? [] : storeSuggestions(stores, storeQuery)),
    [stores, storeQuery]
  );
  // The composer's memory. Only runs while no `@` token is open: the two
  // suggestion sets answer different questions and one strip cannot mean both.
  const pantryMatches = useMemo(
    () =>
      storeQuery !== null ? [] : searchPantry(pantry, draft, { onList: items }),
    [pantry, draft, items, storeQuery]
  );
  /*
    Anything already on the list is left out of the drawer. Offering to put back
    what is on screen is noise, and excluding it makes an accidental tick
    self-correcting: un-ticking puts the row back, which hides its entry again.
  */
  /*
    Entries past their own measured buying rhythm.

    A sharper version of the three bands. Two weeks and two months approximate a
    rhythm and mis-sort some items. Once an item has been bought three times its
    own gaps answer the question directly. The bands remain the answer while
    `buy_count` is 1 or 2.
  */
  const due = useMemo(
    () => dueEntries(pantry, { onList: items }),
    [pantry, items]
  );
  const bands = useMemo(
    // Excluded from the bands below, so nothing is offered twice on one screen.
    () =>
      pantryBands(pantry, { onList: items, exclude: due.map((e) => e.term) }),
    [pantry, items, due]
  );
  const pantryCount = useMemo(
    () => bands.reduce((n, b) => n + b.entries.length, 0),
    [bands]
  );

  const submit = useCallback(async () => {
    // `@` names a store, the way `#` names a project. See `extractStoreToken`
    // for why only the list composers parse it, not `parseTaskInput`.
    const { title, store } = extractStoreToken(draft);
    if (!title) return;
    // Cleared before the write, never after: the field has to be ready for the
    // next word on the same frame, which is what a burst composer is for. `blurOnSubmit={false}` keeps the keyboard up with it.
    setDraft('');
    try {
      await addListItem(listId, {
        title,
        ...(store ? { tags: [storeTag(store)] } : {}),
      });
      setAdded((n) => n + 1);
      hapticLight();
    } catch {
      // Restore what they typed, `@store` included. Restoring the parsed title
      // would silently drop the store when the network fails.
      setDraft(store ? `${title} @${store}` : title);
      toast.show({ message: "Couldn't add that — try again" });
    }
  }, [draft, listId, toast]);

  /**
   * Adds an item back to the list from the pantry.
   *
   * It arrives with the store it was last bought at. That is the difference
   * between taking a suggestion and typing the word again.
   */
  const putBack = useCallback(
    async (entry: PantryEntry) => {
      setDraft('');
      try {
        await addListItem(listId, {
          title: entry.title,
          ...(entry.store ? { tags: [storeTag(entry.store)] } : {}),
        });
        setAdded((n) => n + 1);
        hapticLight();
      } catch {
        toast.show({ message: "Couldn't add that — try again" });
      }
    },
    [listId, toast]
  );

  /** Deletes a pantry entry. The only destructive action on this screen. */
  const forget = useCallback(
    async (entry: PantryEntry) => {
      try {
        await forgetPantryEntry(listId, entry.term);
        toast.show({ message: `Won't suggest ${entry.title} again` });
      } catch {
        toast.show({ message: "Couldn't forget that" });
      }
    },
    [listId, toast]
  );

  const onClear = useCallback(async () => {
    try {
      const ids = await clearGotItems(listId);
      if (ids.length === 0) return;
      toast.show({
        message: `Put away ${ids.length} item${ids.length === 1 ? '' : 's'}`,
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

  /**
   * Sets or clears an item's store.
   *
   * One write, unlike an aisle correction, which is two. There is no lesson to
   * record: a store describes this purchase, not the words. Buying batteries at
   * Target once does not mean batteries always come from Target, whereas
   * "bananas are produce" is a fact about the language and worth remembering.
   */
  const writeStore = useCallback(
    async (item: Task, store: string | null) => {
      setPicking(null);
      try {
        await updateTask(item.id, { tags: withStoreHint(item.tags, store) });
        invalidateLists(listId);
      } catch {
        toast.show({ message: "Couldn't change the store" });
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
          headerRight: () => (
            <View style={styles.headerRight}>
              {got.length > 0 && (
                /*
                  "Put away", not "Clear bought". The write is the same — items
                  are still soft-deleted — but nothing important is lost,
                  because each was recorded in the pantry when it was ticked.
                  That is why it stays one unconfirmed tap.
                */
                <Pressable onPress={onClear} hitSlop={10}>
                  <Text style={styles.clear}>Put away</Text>
                </Pressable>
              )}
              {/* The list's name, icon and colour were only settable at the
                  moment it was created. This is the way back to them, and the
                  only way to delete a list from the phone. */}
              <Pressable
                onPress={() => setEditingList(true)}
                hitSlop={10}
                accessibilityLabel="Edit list"
              >
                <Ionicons name="create-outline" size={21} color="#6366f1" />
              </Pressable>
            </View>
          ),
        }}
      />
      <UpdatingBar visible={loadState.showUpdating} />

      <View
        style={styles.composer}
        onLayout={(e) => setComposerWidth(e.nativeEvent.layout.width)}
      >
        <ComposerActionGlyph
          width={composerWidth}
          active={composerFocused || draft.length > 0}
          // The same test `submit` guards on, so the return key is live
          // exactly when pressing it would write something.
          armed={extractStoreToken(draft).title.length > 0}
          onSubmit={() => void submit()}
          onFocusField={() => inputRef.current?.focus()}
          idleLabel="Add an item"
          submitLabel="Add this item"
        />
        {/* The field keeps clear of both gutters at all times, so the glyph
            has somewhere to sit at either end and the "N added" receipt never
            lands under it. The idle gutter on the right costs 20pt of a field
            nothing else was using. */}
        <View style={styles.composerField}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            // The two props that make this a burst rather than one item: the
            // keyboard stays up, and return commits instead of dismissing.
            blurOnSubmit={false}
            returnKeyType="done"
            submitBehavior="submit"
            placeholder="Add an item to buy"
            placeholderTextColor="#9ca3af"
            style={styles.input}
          />
          {added > 0 && <Text style={styles.added}>{added} added</Text>}
        </View>
      </View>

      {/*
        The stores already on this list, offered while an `@` token is open.

        A horizontal strip rather than a dropdown, so it sits directly under the
        field and above the keyboard, where the thumb already is. It pushes
        nothing else around, since the row only exists while a token is open.
      */}
      {/*
        The composer's memory: a few keystrokes to put back something bought
        repeatedly, with its store attached. Tapping adds it directly rather
        than completing the field, since a confirm step would undo the speed.
      */}
      {storeMatches.length === 0 && pantryMatches.length > 0 && (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          style={styles.storeStrip}
          contentContainerStyle={styles.storeStripInner}
        >
          {pantryMatches.map((entry) => (
            <Pressable
              key={entry.term}
              onPress={() => {
                void putBack(entry);
                inputRef.current?.focus();
              }}
              style={({ pressed }) => [
                styles.pantryChip,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.pantryChipText}>{entry.title}</Text>
              <Text style={styles.pantryChipAge}>
                {lastBoughtLabel(entry.last_bought_at)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {storeMatches.length > 0 && (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          style={styles.storeStrip}
          contentContainerStyle={styles.storeStripInner}
        >
          {storeMatches.map((name) => (
            <Pressable
              key={name}
              onPress={() => {
                setDraft(applyStoreToken(draft, name));
                // The field must keep focus — this is a burst composer and the
                // next word is already coming.
                inputRef.current?.focus();
              }}
              style={({ pressed }) => [
                styles.storeChip,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.storeChipText}>@{name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Text style={styles.subline}>{listSubline(summary)}</Text>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        // A tap on a row while typing must reach the row, not be swallowed
        // dismissing the keyboard.
        // An empty title is the ungrouped case — `groupByAisle` collapses to
        // one unlabelled group when grouping would gain nothing, and that has
        // to render as a plain list with no header at all.
        /*
          Above the list rather than inside the drawer. This is a prompt about
          the trip you are about to make, not a record of past ones, so it has
          to be seen before shopping rather than found afterwards.
        */
        ListHeaderComponent={
          due.length > 0 ? (
            <View style={styles.due}>
              <Text style={styles.dueHeader}>Probably due</Text>
              <View style={styles.duePills}>
                {due.map((entry) => (
                  <Pressable
                    key={entry.term}
                    onPress={() => void putBack(entry)}
                    style={({ pressed }) => [
                      styles.duePill,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${entry.title} — ${cadenceLabel(entry)}, last bought ${lastBoughtLabel(entry.last_bought_at)}`}
                  >
                    <Ionicons name="add" size={14} color="#6366f1" />
                    <Text style={styles.duePillText}>{entry.title}</Text>
                    <Text style={styles.duePillAge}>
                      {lastBoughtLabel(entry.last_bought_at)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            onOpen={() => setEditing(item)}
            onLongPress={() => setPicking(item)}
            // Ticking writes to the pantry, so the drawer has to reload. The
            // write is fire-and-forget inside `TasksApi.update`, so this is a
            // refetch rather than an optimistic patch: the client does not know
            // what the gap arithmetic decided.
            onToggled={() => invalidatePantry(listId)}
          />
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
        // The bar floats over the screen, so the last item — and the pantry
        // under it — has to scroll clear of it. See `useTabBarScrollSync`.
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: 40 + tabBar.contentInset },
        ]}
        onScroll={(e) =>
          tabBar.onScrollOffsetChange?.(e.nativeEvent.contentOffset.y)
        }
        onContentSizeChange={tabBar.onContentSizeChange}
        onLayout={tabBar.onListLayout}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          Keyboard.dismiss();
          tabBar.setDragging(true);
        }}
        onScrollEndDrag={() => tabBar.setDragging(false)}
        /*
          The pantry sits under the list as its footer. It is where the list
          came from, so scrolling past what is left to buy to reach it is the
          right order. A separate tab would turn putting one item back into a
          navigation.
        */
        ListFooterComponent={
          pantryCount > 0 ? (
            <View style={styles.pantry}>
              <Text style={styles.pantryHeader}>
                Bought before · {pantryCount}
              </Text>
              {bands.map((band, i) => (
                <PantryBandView
                  key={band.key}
                  band={band}
                  defaultOpen={i === 0}
                  onAdd={putBack}
                  onForget={forget}
                />
              ))}
            </View>
          ) : null
        }
      />

      <ItemSheet
        item={picking}
        memory={memory}
        stores={stores}
        onAisle={writeAisle}
        onStore={writeStore}
        onClose={() => setPicking(null)}
      />

      {/* The same editor every other row in the app opens — notes, a photo of
          the label, a store hint, a deadline. `invalidateLists` rather than
          `invalidateTasks`, because this screen's items are the one query the
          task caches don't cover. */}
      <TaskEditModalV2
        task={editing}
        visible={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => invalidateLists(listId)}
      />

      <ProjectFormSheet
        visible={editingList}
        project={list ?? undefined}
        onClose={() => setEditingList(false)}
        // The deleted list is this screen, so there is nothing left to show.
        onDeleted={() => router.back()}
      />
    </View>
  );
}

/**
 * Renders one band of the pantry drawer.
 *
 * Only the first is open by default. After a year "Earlier" holds hundreds of
 * rows, and a list screen should not open two screens below its own list. The
 * composer's search is the way into that band.
 *
 * The name is the tap target, unlike an item row. A pantry entry has one
 * possible action, so nothing else competes for the words.
 */
function PantryBandView({
  band,
  defaultOpen,
  onAdd,
  onForget,
}: {
  band: PantryBand;
  defaultOpen: boolean;
  onAdd: (entry: PantryEntry) => void;
  onForget: (entry: PantryEntry) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.bandHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Ionicons
          name={open ? 'chevron-down' : 'chevron-forward'}
          size={13}
          color="#9ca3af"
        />
        <Text style={styles.bandLabel}>
          {band.label} · {band.entries.length}
        </Text>
      </Pressable>
      {open &&
        band.entries.map((entry) => (
          <Pressable
            key={entry.term}
            onPress={() => onAdd(entry)}
            /*
              Deleting is the only irreversible action on this screen, so it is
              behind a long press rather than a visible control. Same reasoning
              as the aisle picker.
            */
            onLongPress={() => {
              hapticMedium();
              onForget(entry);
            }}
            delayLongPress={450}
            style={({ pressed }) => [
              styles.pantryRow,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Put ${entry.title} back on the list`}
          >
            <Ionicons name="add" size={16} color="#9ca3af" />
            <Text style={styles.pantryTitle} numberOfLines={1}>
              {entry.title}
            </Text>
            <Text style={styles.pantryAge}>
              {[
                entry.store,
                cadenceLabel(entry),
                lastBoughtLabel(entry.last_bought_at),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}

/**
 * Lets the user correct an item's aisle and its store.
 *
 * Behind a long press rather than controls on the row. The row's job is to be
 * tapped while walking, and extra targets on that surface would cause mis-ticks.
 * Both corrections are rare and usually made sitting down, so a hidden gesture
 * is an acceptable cost.
 *
 * Store sits above aisle because it changes more often. An aisle is a fact
 * about the words and is usually right first time; a store is a fact about
 * this week.
 *
 * A `Modal` is safe here, unlike in the quick-add composer. Nothing on this
 * screen is keyboard-anchored when a row is long-pressed, so there is no IME
 * for a second window to drop. The new-store field opens its own keyboard
 * inside that window, which is unaffected.
 */
function ItemSheet({
  item,
  memory,
  stores,
  onAisle,
  onStore,
  onClose,
}: {
  item: Task | null;
  /** So the tick sits on the aisle the row is actually filed under. */
  memory?: AisleMemory;
  /** Stores already on this list, listed above the free-text field. */
  stores: string[];
  onAisle: (item: Task, aisle: Aisle | null) => void;
  onStore: (item: Task, store: string | null) => void;
  onClose: () => void;
}) {
  const [newStore, setNewStore] = useState('');
  if (!item) return null;
  const current = itemAisle(item, memory);
  const store = storeHint(item);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetSection}>Where you get it</Text>
            {stores.map((name) => (
              <Pressable
                key={name}
                onPress={() => onStore(item, name)}
                style={({ pressed }) => [
                  styles.option,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.optionText}>{name}</Text>
                {store !== null && store === name && (
                  <Ionicons name="checkmark" size={17} color="#6366f1" />
                )}
              </Pressable>
            ))}
            <Pressable
              onPress={() => onStore(item, null)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text style={[styles.optionText, styles.optionMuted]}>
                Anywhere
              </Text>
              {store === null && (
                <Ionicons name="checkmark" size={17} color="#6366f1" />
              )}
            </Pressable>
            {/* A store the list has not seen before. The composer's `@` covers
                this when adding; this covers realising it at the shelf. */}
            <View style={styles.newStoreRow}>
              <TextInput
                value={newStore}
                onChangeText={setNewStore}
                placeholder="Another shop…"
                placeholderTextColor="#9ca3af"
                style={styles.newStoreInput}
                returnKeyType="done"
                onSubmitEditing={() => {
                  const name = newStore.trim();
                  if (name) onStore(item, name);
                }}
              />
            </View>

            <Text style={styles.sheetSection}>Aisle</Text>
            {aisleOptions().map((option) => (
              <Pressable
                key={option.value}
                onPress={() => onAisle(item, option.value)}
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
                land in Other, so a label saying it would misdescribe it. */}
            <Pressable
              onPress={() => onAisle(item, null)}
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

/**
 * One thing to buy.
 *
 * Three gestures, and the split between the first two is what matters: **the
 * circle ticks, the words open.** They used to be one target, so a tap meant
 * for "what did I write here" bought the thing instead — a mistake the user
 * has to notice and undo, on the surface they tap fastest.
 *
 * The circle is 21px and the thumb is not, so its `hitSlop` takes the target
 * back out to the full height of the row and past its left edge. That keeps
 * what a walking tap needs — a target it can hit without looking — while the
 * rest of the row means something else.
 */
function ItemRow({
  item,
  onOpen,
  onLongPress,
  onToggled,
}: {
  item: Task;
  onOpen: () => void;
  onLongPress: () => void;
  onToggled: () => void;
}) {
  const done = item.status === 'done' || item.status === 'cancelled';
  // The store and the day as one muted line, the same shape `rowSubline` gives
  // every other row in the app. Empty for most items, so nothing renders.
  const subline = itemSubline(item).join(' · ');
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={() => {
        hapticMedium();
        onLongPress();
      }}
      delayLongPress={300}
      style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.title}`}
    >
      <Pressable
        onPress={() => {
          hapticLight();
          void toggleComplete(item.id, !done).then(onToggled, onToggled);
        }}
        hitSlop={{ top: 13, bottom: 13, left: 14, right: 10 }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`Mark ${item.title} as ${
          done ? 'not bought' : 'bought'
        }`}
      >
        <View style={[styles.box, done && styles.boxDone]}>
          {done && <Ionicons name="checkmark" size={13} color="#ffffff" />}
        </View>
      </Pressable>
      {/*
        The title and subline are a column, so the column takes the row's spare
        width and the Text inside it must not.

        `styles.itemText` therefore has no `flex: 1`, and must not get one back.
        Flex-basis resolves against the container's main axis, so `flex: 1` here
        would set a vertical basis of 0 and collapse the title to height 0. This
        is the same trap documented on the task row's title.
      */}
      <View style={styles.itemBody}>
        <Text style={[styles.itemText, done && styles.itemTextDone]}>
          {item.title}
        </Text>
        {subline !== '' && (
          <Text style={styles.itemSubline} numberOfLines={1}>
            {subline}
          </Text>
        )}
      </View>
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  clear: { fontSize: 13, fontWeight: '600', color: '#6366f1' },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: GLYPH_PAD,
    paddingVertical: 10,
    borderRadius: 12,
  },
  // Clears the glyph's gutter at both ends, whichever one it is parked in.
  composerField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: GLYPH_CLEARANCE,
  },
  input: { flex: 1, fontSize: 15, color: '#111827', padding: 0 },
  added: { fontSize: 11, color: '#9ca3af', fontVariant: ['tabular-nums'] },
  storeStrip: { flexGrow: 0, marginTop: 8 },
  storeStripInner: { paddingHorizontal: 12, gap: 8 },
  storeChip: {
    backgroundColor: '#eef0fe',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  storeChipText: { fontSize: 13, fontWeight: '600', color: '#4338ca' },
  pantryChip: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  pantryChipText: { fontSize: 13, fontWeight: '600', color: '#111827' },
  pantryChipAge: { fontSize: 11, color: '#9ca3af' },
  due: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    backgroundColor: '#eef0fe',
    borderRadius: 12,
  },
  dueHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338ca',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 4,
    paddingBottom: 7,
  },
  duePills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  duePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  duePillText: { fontSize: 13, fontWeight: '600', color: '#111827' },
  duePillAge: { fontSize: 11, color: '#9ca3af' },
  pantry: {
    marginTop: 18,
    marginHorizontal: 12,
    padding: 10,
    backgroundColor: '#ffffff',
    borderRadius: 12,
  },
  pantryHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6366f1',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  bandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
    paddingTop: 10,
    paddingBottom: 4,
  },
  bandLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  pantryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 9,
  },
  pantryTitle: { flex: 1, fontSize: 14, color: '#374151' },
  pantryAge: { fontSize: 11, color: '#9ca3af' },
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
    // Not 'center'. A row can be two lines of title plus a subline, and a ring
    // centred against that looks detached from the word it ticks off.
    alignItems: 'flex-start',
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
  // Fills the row's width, so the title inside it does not have to. See above.
  itemBody: { flex: 1, gap: 2 },
  itemText: { fontSize: 15, color: '#111827' },
  itemTextDone: { color: '#9ca3af', textDecorationLine: 'line-through' },
  itemSubline: { fontSize: 12, color: '#6b7280' },
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
  sheetSection: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 4,
  },
  newStoreRow: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 2 },
  newStoreInput: {
    backgroundColor: '#f3f4f6',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
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
