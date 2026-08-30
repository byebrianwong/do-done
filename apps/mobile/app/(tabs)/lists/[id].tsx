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
  AISLE_COLOR,
  aisleOptions,
  gotItems,
  groupByAisle,
  isGot,
  itemAisle,
  listSubline,
  openItems,
  sameStore,
  storeHints,
  storeLabel,
  storeSuggestions,
  storeTag,
  storesOnList,
  storesTyped,
  summarizeList,
  typingStoreToken,
  applyStoreToken,
  extractStoreTokens,
  withAisle,
  toggleStoreHint,
  withStoreHints,
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
import { updateTask } from '@/lib/task-queries';
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
import ListItemRow from '@/components/ListItemRow';
import {
  SectionCount,
  sectionHeaderStyles,
} from '@/components/SectionHeader';
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
  const title = list?.name ?? 'List';
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
  /*
    The long-pressed item, held by id rather than by value.

    The store rows in that sheet toggle, so it stays open across a write and
    has to redraw with the item's new tags. A `Task` snapshot would keep the
    tags it was opened with, and the ticks would stop moving after the first
    tap.
  */
  const [pickingId, setPickingId] = useState<string | null>(null);
  const picking = useMemo(
    () => items.find((t) => t.id === pickingId) ?? null,
    [items, pickingId]
  );
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
    () =>
      storeQuery === null
        ? []
        : // Shops already named on this line are left out, so a second `@`
          // offers the ones still to pick rather than repeating the first.
          storeSuggestions(stores, storeQuery, { exclude: storesTyped(draft) }),
    [stores, storeQuery, draft]
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
    // `@` names a store, the way `#` names a project. See `extractStoreTokens`
    // for why only the list composers parse it, not `parseTaskInput`.
    const { title, stores: typed } = extractStoreTokens(draft);
    if (!title) return;
    // Cleared before the write, never after: the field has to be ready for the
    // next word on the same frame, which is what a burst composer is for. `blurOnSubmit={false}` keeps the keyboard up with it.
    setDraft('');
    try {
      await addListItem(listId, {
        title,
        ...(typed.length > 0 ? { tags: typed.map(storeTag) } : {}),
      });
      setAdded((n) => n + 1);
      hapticLight();
    } catch {
      // Restore what they typed, every `@store` included. Restoring the parsed
      // title alone would silently drop the shops when the network fails.
      setDraft([title, ...typed.map((name) => `@${name}`)].join(' ').trim());
      toast.show({ message: "Couldn't add that — try again" });
    }
  }, [draft, listId, toast]);

  /**
   * Adds an item back to the list from the pantry.
   *
   * It arrives with the shops it was last bought at — all of them, since an
   * item sold in two places was named that way for a reason. That is the
   * difference between taking a suggestion and typing the word again.
   */
  const putBack = useCallback(
    async (entry: PantryEntry) => {
      setDraft('');
      try {
        await addListItem(listId, {
          title: entry.title,
          ...(entry.stores.length > 0
            ? { tags: entry.stores.map(storeTag) }
            : {}),
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
      // The dot beside the header takes the same colour the rows' rings do, so
      // a group and its items read as one thing. Null on the "Other" group and
      // on the collapsed one, neither of which names an aisle.
      color: g.aisle ? AISLE_COLOR[g.aisle] : null,
      data: g.items,
    }));
    return [
      ...aisles,
      // The bought pile keeps its own heading and its count, so a mis-tick
      // while walking is one glance from being found. Never grouped: it is a
      // record of what happened, not a route through anything.
      ...(got.length > 0
        ? [{ title: 'Got it', color: null, data: got }]
        : []),
    ].filter((s) => s.data.length > 0);
  }, [open, got, memory]);

  /**
   * Each item's aisle, by id.
   *
   * Computed per item rather than taken from the section it landed in, because
   * `groupByAisle` collapses to one unlabelled group on a short list — and a
   * three-item list should still draw a carrot on the carrots. Once here, so a
   * screen of rows costs one pass over the lexicon rather than one per row.
   */
  const itemAisles = useMemo(
    () => new Map(items.map((i) => [i.id, itemAisle(i, memory)])),
    [items, memory]
  );

  /**
   * Move an item to a different aisle.
   *
   * Written as a tag rather than inferred again, so the correction survives
   * every future render *and* every future change to the lexicon: the shelf
   * the user is standing at outranks our guess about the word, permanently.
   */
  const writeAisle = useCallback(
    async (item: Task, aisle: Aisle | null) => {
      setPickingId(null);
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
   * Adds a shop to an item, or takes it off again.
   *
   * One write, unlike an aisle correction, which is two. There is no lesson to
   * record: a store describes this purchase, not the words. Buying batteries at
   * Target once does not mean batteries always come from Target, whereas
   * "bananas are produce" is a fact about the language and worth remembering.
   *
   * The sheet stays open, unlike an aisle pick, which closes it. An item can
   * name several shops, so the answer is not finished after one tap — closing
   * on the first would mean a long press per shop.
   */
  const writeStores = useCallback(
    async (item: Task, tags: string[]) => {
      try {
        await updateTask(item.id, { tags });
        invalidateLists(listId);
      } catch {
        toast.show({ message: "Couldn't change the store" });
      }
    },
    [listId, toast]
  );

  const toggleStore = useCallback(
    (item: Task, store: string) =>
      writeStores(item, toggleStoreHint(item.tags, store)),
    [writeStores]
  );

  /** Clears every shop on an item — the "Anywhere" answer. */
  const clearStores = useCallback(
    (item: Task) => writeStores(item, withStoreHints(item.tags, [])),
    [writeStores]
  );

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title,
          // The ring goes in the title, never in `headerLeft`: overriding that
          // slot replaces the back button, and the only ways out left are the
          // edge swipe and the tab, neither of which the screen says anything
          // about. Same shape as the project screen.
          headerTitle: () => (
            <View style={styles.headerTitle}>
              {list ? (
                <View style={[styles.ring, { backgroundColor: list.color }]}>
                  <ProjectIcon icon={list.icon} size={12} color="#ffffff" />
                </View>
              ) : null}
              <Text style={styles.headerText} numberOfLines={1}>
                {title}
              </Text>
            </View>
          ),
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
          armed={extractStoreTokens(draft).title.length > 0}
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
        /*
          The key carries which side of the list the row is on, not just its id.

          A row plays a collapse on its way out — `ListItemRow` shrinks its own
          height so the rows below travel up — and then the cache patch moves it
          between the aisles and "Got it". Keyed by id alone, React reconciles
          those as the *same* element whenever the row lands at the same index in
          the flattened list, so the instance survives with its exit state still
          collapsed and the row is drawn at zero height in its new section. With
          one item on the list that is every time: a "Got it · 1" header over
          nothing at all.

          Changing the key on the move forces a remount, which is also what the
          row is: a fresh row, at full height, in a different place.
        */
        keyExtractor={(item) => `${item.id}:${isGot(item) ? 'got' : 'open'}`}
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
        // An aisle header has to stay on screen while its aisle does, or a
        // long list stops saying which shelf you are reading. Same rule as
        // every other list in the app — see *Sticky list headers*.
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View style={sectionHeaderStyles.container}>
              {section.color ? (
                <View
                  style={[
                    sectionHeaderStyles.dot,
                    { backgroundColor: section.color },
                  ]}
                />
              ) : null}
              <Text style={sectionHeaderStyles.text}>{section.title}</Text>
              <SectionCount value={section.data.length} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ListItemRow
            item={item}
            aisle={itemAisles.get(item.id) ?? null}
            onOpen={() => setEditing(item)}
            onCorrect={() => setPickingId(item.id)}
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
        onToggleStore={toggleStore}
        onClearStores={clearStores}
        onClose={() => setPickingId(null)}
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
                storeLabel(entry.stores),
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
  onToggleStore,
  onClearStores,
  onClose,
}: {
  item: Task | null;
  /** So the tick sits on the aisle the row is actually filed under. */
  memory?: AisleMemory;
  /** Stores already on this list, listed above the free-text field. */
  stores: string[];
  onAisle: (item: Task, aisle: Aisle | null) => void;
  onToggleStore: (item: Task, store: string) => void;
  onClearStores: (item: Task) => void;
  onClose: () => void;
}) {
  const [newStore, setNewStore] = useState('');
  if (!item) return null;
  const current = itemAisle(item, memory);
  const chosen = storeHints(item);
  /*
    Shops named on this item but not used anywhere else on the list — typed at
    the shelf, or arrived with the item from another list. Without this they
    would carry a tick nothing on screen showed, since `stores` only knows what
    the list uses.
  */
  const shown = [
    ...stores,
    ...chosen.filter(
      (name) => !stores.some((known) => sameStore(known, name))
    ),
  ];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {/* Every shop ticks on and off independently, and the sheet stays
                open, because an item can be sold in more than one place. The
                aisle rows below are still one-of, and still close: a thing is
                in one aisle. */}
            <Text style={styles.sheetSection}>Where you get it</Text>
            {shown.map((name) => (
              <Pressable
                key={name}
                onPress={() => onToggleStore(item, name)}
                style={({ pressed }) => [
                  styles.option,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.optionText}>{name}</Text>
                {chosen.some((s) => sameStore(s, name)) && (
                  <Ionicons name="checkmark" size={17} color="#6366f1" />
                )}
              </Pressable>
            ))}
            {/* Clears them all, rather than being a shop of its own. It is the
                only way back to "no opinion" once two are ticked, short of
                un-ticking each. */}
            <Pressable
              onPress={() => onClearStores(item)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text style={[styles.optionText, styles.optionMuted]}>
                Anywhere
              </Text>
              {chosen.length === 0 && (
                <Ionicons name="checkmark" size={17} color="#6366f1" />
              )}
            </Pressable>
            {/* A store the list has not seen before. The composer's `@` covers
                this when adding; this covers realising it at the shelf. The
                field clears on submit, so a second shop can follow the first. */}
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
                  if (!name) return;
                  setNewStore('');
                  onToggleStore(item, name);
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { fontSize: 17, fontWeight: '700', color: '#111827' },
  ring: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
  },
  // No top padding: the first thing in the list is either a section header,
  // which brings its own, or a full-bleed row that should meet the summary
  // line above it.
  listContent: { paddingBottom: 40 },
  pressed: { opacity: 0.65 },
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
