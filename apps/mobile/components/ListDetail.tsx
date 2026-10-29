import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  RefreshControl,
  Keyboard,
  Modal,
  ScrollView,
  BackHandler,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  ComposerActionGlyph,
  GLYPH_CLEARANCE,
  GLYPH_PAD,
} from '@/components/ComposerActionGlyph';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import type {
  Aisle,
  AisleMemory,
  CreateTaskInput,
  PantryBand,
  PantryEntry,
  Project,
  Task,
} from '@do-done/shared';
import {
  ALL_SHOPPING_ID,
  ALL_SHOPPING_NAME,
  AISLE_COLOR,
  aisleOptions,
  defaultAllShoppingTarget,
  extractListToken,
  isShoppingList,
  listCopy,
  shoppingLists,
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
  clearGotItemsIn,
  forgetPantryEntry,
  invalidateAisleMemory,
  invalidateLists,
  invalidatePantry,
  loadAllShoppingTarget,
  previewAisleLesson,
  rememberAisle,
  restoreItems,
  saveAllShoppingTarget,
  useAisleMemory,
  useList,
  useListItems,
  useLists,
  usePantry,
} from '@/lib/list-queries';
import { moveTask, reorderTasks, updateTask } from '@/lib/task-queries';
import {
  ALL_SECTION,
  GOT_SECTION,
  aisleSectionKey,
  itemDrop,
} from '@/lib/list-item-drop';
import { usePullToRefresh, useRefreshOnFocus } from '@/lib/query-client';
import { useTabBarMinimize } from '@/lib/tab-bar-minimize';
import { TAB_BAR_ROW_HEIGHT } from '@/lib/tab-bar-motion';
import { markResumeTried, saveResume } from '@/lib/tab-resume';
import {
  pinAllShoppingShortcut,
  scheduleListShortcutSync,
} from '@/lib/list-shortcuts';
import { useListLoadState } from '@/lib/list-load-state';
import {
  ListError,
  ListSkeleton,
  UpdatingBar,
} from '@/components/ListPlaceholder';
import { ProjectIcon } from '@/components/ProjectIcon';
import ListItemRow from '@/components/ListItemRow';
import SectionedDraggableList, {
  type DraggableSection,
} from '@/components/SectionedDraggableList';
import QuickAddButton from '@/components/QuickAddButton';
import {
  SectionCount,
  sectionHeaderStyles,
} from '@/components/SectionHeader';
import { openProjectForm } from '@/components/ProjectFormSheet';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import { useUndoToast } from '@/components/UndoToast';
import { hapticLight, hapticMedium } from '@/lib/haptics';
import { prefersReducedMotion } from '@/lib/use-row-exit';
import { isPendingItem } from '@/lib/list-item-add';

/** Space between the composer card and the keyboard or tab bar below it. */
const COMPOSER_GAP = 8;

/*
  The composer's entrance and exit. Short, because the keyboard is moving at
  the same time and the card should arrive with it rather than after it. The
  slide is a nudge, not the card's full height: the keyboard carries the card
  the rest of the way.
*/
const COMPOSER_IN_MS = 220;
const COMPOSER_OUT_MS = 180;
const COMPOSER_SLIDE_PX = 28;

/*
  The fade the list plays when it regroups, at `AISLE_GROUP_MIN_ITEMS` open
  items, into aisles or back out of them. See `listFadeStyle`.
*/
const REGROUP_FROM_OPACITY = 0.35;
const REGROUP_MS = 260;

/** What an item added to a list is written with. */
type NewItem = Omit<CreateTaskInput, 'project_id'>;

/** The tags an item put back from the pantry arrives with. */
function pantryInput(entry: PantryEntry): NewItem {
  return {
    title: entry.title,
    ...(entry.stores.length > 0 ? { tags: entry.stores.map(storeTag) } : {}),
  };
}

/*
  The row key carries which side of the list the row is on, not just its id.
  See the note where it is passed. Module-level so the list gets the same
  function on every render.
*/
const itemRowKey = (item: Task) => `${item.id}:${isGot(item) ? 'got' : 'open'}`;

/** A section of the list, with the colour its header dot is drawn in. */
type ListSection = DraggableSection & { color: string | null };

/**
 * A shopping list.
 *
 * Deliberately not `GroupedTaskList`. Every axis that component exists to offer
 * — group by status, sort by deadline, filter by priority — is meaningless on a
 * list of things to buy, and the row it draws spends its width on a project
 * ring and an urgency gutter that a list has no use for. What is left is a
 * checkbox, a word, and a text field that must not lose focus.
 *
 * Items are added with the plus button in the bottom-right corner, the same
 * `QuickAddButton` the task screens use. There used to be a text field pinned
 * at the top of the list. It took up a row on a screen that is read far more
 * often than it is added to.
 *
 * The button opens this screen's own composer, not `dodone://quick-add`. The
 * task composer closes after each add and shows date, priority and estimate
 * chips that do not apply to groceries. The list composer stays open for the
 * next item, parses `@store`, and suggests items from the pantry. It now sits
 * in a sheet above the keyboard instead of at the top of the screen.
 *
 * The sheet is not a `Modal`: on Android a Modal opens a new window and closes
 * the keyboard.
 *
 * **One screen, three kinds of list.** `listId` is a list's id or
 * `ALL_SHOPPING_ID`, and the screen is in one of three modes:
 *
 * | Mode | Items | Aisles, `@store`, pantry | Composer adds to |
 * | --- | --- | --- | --- |
 * | Shopping list | this list | yes | this list |
 * | Checklist (`is_shopping` false) | this list | no | this list |
 * | All shopping | every shopping list | aisles and `@store`; the pantry only in the composer | the list chip |
 *
 * One component rather than three, because everything that makes this screen
 * careful (the burst composer, the tick animation's keying, the keyboard
 * lift) is the same in all of them, and three copies is how one of them stops
 * being careful.
 *
 * It does use `SectionedDraggableList`, the drag layer under `GroupedTaskList`,
 * so a long press picks an item up and it can be dropped into another aisle or
 * the cart, as a task can be dropped into another section.
 */
export function ListDetail({ listId }: { listId: string }) {
  const combined = listId === ALL_SHOPPING_ID;
  // Disabled for the combined view: there is no project row behind it.
  const { data: fetched } = useList(combined ? '' : listId);
  // Every list. The combined view takes its lists and its chip from here, and
  // a single list falls back to its row here while its own read is in the air.
  // The index has usually loaded it already, so the title and the mode are
  // right on the first frame.
  const { data: allLists = [] } = useLists();
  const list = combined
    ? undefined
    : fetched ?? allLists.find((l) => l.id === listId);
  const shopLists = useMemo(() => shoppingLists(allLists), [allLists]);
  /*
    Whether the shopping features are on. A list not loaded yet counts as a
    shopping list, because nearly every list is one: guessing checklist would
    flash a flat list that regroups into aisles a moment later.
  */
  const shopping = combined || (list ? isShoppingList(list) : true);
  // Memoised: `listCopy` builds a new object per call, and the header's
  // options depend on it.
  const copy = useMemo(() => listCopy(shopping), [shopping]);
  const title = combined ? ALL_SHOPPING_NAME : (list?.name ?? 'List');
  /** The list name printed on each row. Only the combined view needs one. */
  const listNames = useMemo(
    () => new Map(shopLists.map((l) => [l.id, l.name])),
    [shopLists]
  );
  /*
    Which list the combined composer adds to: the last one added to, while it
    is still a shopping list, else the first. Loaded once from storage and then
    owned here, so a chip tap moves it on the same frame.
  */
  const [lastTarget, setLastTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!combined) return;
    let cancelled = false;
    void loadAllShoppingTarget().then((id) => {
      if (!cancelled && id) setLastTarget((current) => current ?? id);
    });
    return () => {
      cancelled = true;
    };
  }, [combined]);
  const chosenTarget = combined
    ? defaultAllShoppingTarget({ lists: shopLists, lastId: lastTarget })
    : listId;
  const itemsQuery = useListItems(listId);
  const { data: items = [], refetch } = itemsQuery;
  const loadState = useListLoadState(itemsQuery);
  useRefreshOnFocus(refetch);
  const { refreshing, onRefresh } = usePullToRefresh(refetch);
  // Absent until it loads, and an empty map is the correct fallback: without a
  // memory the lexicon still guesses.
  const { data: memory } = useAisleMemory();
  // Everything ever bought on this list. Empty until it loads, which is the
  // correct fallback: the screen is then a plain shopping list, which is what
  // it was before this existed.
  //
  // A checklist has none. The combined view reads the pantry of the list its
  // composer is adding to, which is the one list a suggestion would land in.
  const { data: pantry = [] } = usePantry(
    shopping && chosenTarget ? chosenTarget : ''
  );

  // What the Lists tab opens on next time. Written while you are looking at
  // the list rather than when you leave it, so a kill from here still counts.
  //
  // The launcher's list quick action follows the same memory, so that the app
  // icon and the tab cannot offer two different answers to "which list is
  // mine". Debounced and Android-only — see lib/list-shortcuts.ts.
  useFocusEffect(
    useCallback(() => {
      saveResume('lists', listId);
      scheduleListShortcutSync();
      // Being on a list spends the tab's restore, however you got here. The
      // row's own `onPress` already did this; a launcher shortcut opening
      // `dodone://lists/<id>` is the case that did not, and without it the
      // index would still be holding an unused restore — so backing out of a
      // deep-linked list, or re-tapping the Lists tab, would decide to open
      // the very list you were leaving. That is the navigate-in-a-loop failure
      // `lib/tab-resume.ts` exists to keep out.
      markResumeTried('lists');
    }, [listId])
  );

  const router = useRouter();
  /*
    Whether the composer sheet is open. The plus button opens it.

    The typed text, the "N added" receipt and everything derived from the text
    live in `ListComposer`, not here. Held here, every keystroke re-rendered
    this whole screen: the native header, every row and the pantry drawer.
  */
  const [composerOpen, setComposerOpen] = useState(false);
  const composerOpenRef = useRef(false);
  /**
   * Whether the composer is drawn. Stays true for the length of the closing
   * animation after `composerOpen` goes false, so the card can leave rather
   * than vanish.
   */
  const [composerMounted, setComposerMounted] = useState(false);
  /**
   * Bumped on every open. It is the composer's key, so each open starts with
   * an empty field and a zero count even when it interrupts a close.
   */
  const [composerSession, setComposerSession] = useState(0);
  /** 0 closed, 1 open. Drives the scrim, the card's slide and its fade. */
  const composerShown = useSharedValue(0);
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
  const toast = useUndoToast();

  /**
   * Put "All shopping" on the home screen as its own icon.
   *
   * Only the failures speak, for the reason the list version gives: Android's
   * own dialog does the asking and never reports what the user chose.
   */
  const pinCombined = useCallback(async () => {
    const result = await pinAllShoppingShortcut();
    if (result === 'unsupported') {
      toast.show({ message: 'This launcher cannot add shortcuts' });
    } else if (result === 'failed') {
      toast.show({
        message: `Could not add ${ALL_SHOPPING_NAME} to the home screen`,
      });
    }
  }, [toast]);
  const insets = useSafeAreaInsets();
  /*
    With the keyboard down, the composer sits above the tab bar. The tab bar
    floats over this screen, so a card at the bottom edge would be hidden
    behind it. The plus button uses the same offset.
  */
  const restingClearance = useTabBarMinimize()
    ? insets.bottom + TAB_BAR_ROW_HEIGHT
    : insets.bottom;
  const restingGap = restingClearance + COMPOSER_GAP;
  // Follow the keyboard height every frame, as `QuickAddComposer` does. The
  // keyboard height is measured from the screen's bottom edge, and the card
  // already sits `restingClearance` above that edge, so lift it by the
  // difference. `COMPOSER_GAP` is not subtracted, so the card keeps an 8pt gap
  // above the keyboard as well as above the tab bar.
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const liftStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -Math.max(keyboard.height.value - restingClearance, 0) },
    ],
  }));

  /**
   * Opens the composer. It slides and fades in while the keyboard rises.
   * Reduce Motion lands on the open state at once.
   */
  const openComposer = useCallback(() => {
    composerOpenRef.current = true;
    setComposerSession((n) => n + 1);
    setComposerMounted(true);
    setComposerOpen(true);
    composerShown.value = prefersReducedMotion()
      ? 1
      : withTiming(1, {
          duration: COMPOSER_IN_MS,
          easing: Easing.out(Easing.cubic),
        });
  }, [composerShown]);

  /** Unmounts the composer once its exit has played. */
  const finishClose = useCallback(() => {
    // A tap on the plus in the last frame of the exit has opened it again.
    if (!composerOpenRef.current) setComposerMounted(false);
  }, []);

  /*
    Closing clears any half-typed text, because the composer unmounts once it
    has left and the text goes with it. Otherwise the text would be kept while
    the sheet is hidden, with nothing on screen showing it is there.

    The card stays drawn while it slides and fades out, so it leaves with the
    keyboard rather than vanishing while the keyboard is still on its way
    down. It stops taking touches at once (`open` goes false).
  */
  const closeComposer = useCallback(() => {
    composerOpenRef.current = false;
    Keyboard.dismiss();
    setComposerOpen(false);
    if (prefersReducedMotion()) {
      composerShown.value = 0;
      setComposerMounted(false);
      return;
    }
    composerShown.value = withTiming(
      0,
      { duration: COMPOSER_OUT_MS, easing: Easing.in(Easing.cubic) },
      (done) => {
        if (done) runOnJS(finishClose)();
      }
    );
  }, [composerShown, finishClose]);

  /*
    Android's back button closes the composer before it leaves the screen.
    With the keyboard up, the system takes the first press to lower it and
    this never hears it; the next press reaches here. Without this, that
    press popped the whole list.
  */
  useEffect(() => {
    if (!composerOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeComposer();
      return true;
    });
    return () => sub.remove();
  }, [composerOpen, closeComposer]);

  const open = useMemo(() => openItems(items), [items]);
  const got = useMemo(() => gotItems(items), [items]);
  const summary = useMemo(() => summarizeList(items), [items]);
  // Every store already named on this list, most-used first. Bought items
  // count too: the cart holds last week's stores, and dropping them on a tick
  // would empty the suggestions when they are most useful.
  const stores = useMemo(() => storesOnList(items), [items]);
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
  //
  // Neither these nor the drawer below appear in the combined view. Both are
  // a record of one list, and over several they would offer to put things
  // back on a list the screen does not otherwise single out.
  const showPantry = shopping && !combined;
  const due = useMemo(
    () => (showPantry ? dueEntries(pantry, { onList: items }) : []),
    [showPantry, pantry, items]
  );
  const bands = useMemo(
    // Excluded from the bands below, so nothing is offered twice on one screen.
    () =>
      showPantry
        ? pantryBands(pantry, {
            onList: items,
            exclude: due.map((e) => e.term),
          })
        : [],
    [showPantry, pantry, items, due]
  );
  const pantryCount = useMemo(
    () => bands.reduce((n, b) => n + b.entries.length, 0),
    [bands]
  );

  /**
   * Writes a new item. Optimistic: the row is in the list before this
   * resolves (see `addListItem`).
   */
  const addItem = useCallback(
    (target: string, input: NewItem) =>
      addListItem(target, input, combined ? { alsoInto: ALL_SHOPPING_ID } : {}),
    [combined]
  );

  /**
   * A list pill tap in the combined composer, and the list a combined add
   * went to. "The list last added to" is the default for the next item, so a
   * typed `#household` moves the pill for the rest of the burst too.
   */
  const chooseTarget = useCallback((id: string) => {
    setLastTarget(id);
    void saveAllShoppingTarget(id);
  }, []);

  /**
   * Adds an item back to the list from the pantry.
   *
   * It arrives with the shops it was last bought at — all of them, since an
   * item sold in two places was named that way for a reason. That is the
   * difference between taking a suggestion and typing the word again.
   */
  const putBack = useCallback(
    async (entry: PantryEntry) => {
      // The pantry is the target list's, so the entry goes back there.
      if (!chosenTarget) return;
      hapticLight();
      try {
        await addItem(chosenTarget, pantryInput(entry));
      } catch {
        toast.show({ message: `Couldn't add ${entry.title} — try again` });
      }
    },
    [chosenTarget, addItem, toast]
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
      // The combined cart holds items from every shopping list, so its sweep
      // covers all of them: one tap, one undo.
      const ids = combined
        ? await clearGotItemsIn(shopLists.map((l) => l.id))
        : await clearGotItems(listId);
      if (ids.length === 0) return;
      toast.show({
        message: copy.cleared(ids.length),
        undo: async () => {
          await restoreItems(listId, ids);
        },
      });
    } catch {
      toast.show({ message: "Couldn't clear the list" });
    }
  }, [combined, shopLists, listId, copy, toast]);

  const sections = useMemo((): ListSection[] => {
    // Aisle groups in walking order. `groupByAisle` collapses to one unlabelled
    // group when grouping would gain nothing, which is what makes a short list
    // — or one full of words the lexicon doesn't know — look like the plain
    // list it always was rather than a broken grouped one.
    //
    // A checklist is never grouped: an aisle header over "passport" would be
    // the lexicon guessing at a list that is not about shops at all.
    const aisles = shopping
      ? groupByAisle(open, { memory }).map((g) => ({
          // What a drop into this section is read back as. See
          // lib/list-item-drop.
          key: aisleSectionKey(g),
          title: g.label,
          // The dot beside the header takes the same colour the rows' rings
          // do, so a group and its items read as one thing. Null on the
          // "Other" group and on the collapsed one, neither of which names an
          // aisle.
          color: g.aisle ? AISLE_COLOR[g.aisle] : null,
          data: g.items,
        }))
      : [{ key: ALL_SECTION, title: '', color: null, data: open }];
    return [
      ...aisles,
      // The bought pile keeps its own heading and its count, so a mis-tick
      // while walking is one glance from being found. Never grouped: it is a
      // record of what happened, not a route through anything.
      ...(got.length > 0
        ? [{ key: GOT_SECTION, title: copy.gotHeader, color: null, data: got }]
        : []),
    ].filter((s) => s.data.length > 0);
  }, [shopping, open, got, memory, copy]);
  const headerColors = useMemo(
    () => new Map(sections.map((s) => [s.key, s.color])),
    [sections]
  );

  /**
   * Each item's aisle, by id.
   *
   * Computed per item rather than taken from the section it landed in, because
   * `groupByAisle` collapses to one unlabelled group on a short list — and a
   * three-item list should still draw a carrot on the carrots. Once here, so a
   * screen of rows costs one pass over the lexicon rather than one per row.
   */
  const itemAisles = useMemo(
    () =>
      new Map(
        items.map((i) => [i.id, shopping ? itemAisle(i, memory) : null])
      ),
    [shopping, items, memory]
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

  /*
    Dragging. A long press picks a row up, the same as on every task list.
    Dropped in a different section, the item is filed there: see
    `lib/list-item-drop.ts` for what each section writes. Released without
    moving, a shopping list opens the item sheet, which is what the long press
    did before. A checklist has nothing to correct, so there the hold does
    nothing.

    `aheadOfNew` ranks the dropped order below the column default of 0, so an
    item added afterwards still appears at the bottom of its aisle.
  */
  const onReorder = useCallback(
    (_sectionKey: string, ids: string[]) => {
      // A stand-in still waiting on its insert has no row to rank yet.
      void reorderTasks(ids.filter((i) => !isPendingItem(i)), {
        aheadOfNew: true,
      }).catch(() =>
        toast.show({ message: "Couldn't move that item" })
      );
    },
    [toast]
  );

  const onMove = useCallback(
    (id: string, _fromKey: string, toKey: string, ids: string[]) => {
      const item = items.find((t) => t.id === id);
      const drop = item ? itemDrop(item, toKey, memory) : null;
      // Refused: the row goes back where it was picked up.
      if (!item || !drop) return false;
      const { patch, teach } = drop;
      if (teach !== undefined) previewAisleLesson(item.title, teach);
      void moveTask(
        id,
        patch,
        ids.filter((i) => !isPendingItem(i)),
        { aheadOfNew: true }
      )
        .then(async () => {
          // The same two halves as a correction made in the item sheet: the
          // tag fixes this row, the lesson fixes the same words next week.
          if (teach !== undefined) await rememberAisle(item.title, teach);
          // A tick or un-tick on a shopping list is recorded in the pantry
          // inside `TasksApi.update`, so the drawer has to reload.
          if (patch.status && shopping && item.project_id) {
            invalidatePantry(item.project_id);
          }
        })
        .catch(() => {
          // `moveTask` has already put the cached rows back. The previewed
          // lesson is taken back by reading the memory again.
          if (teach !== undefined) invalidateAisleMemory();
          toast.show({ message: "Couldn't move that item" });
        });
      return true;
    },
    [items, memory, shopping, toast]
  );

  const renderHeader = useCallback(
    (section: DraggableSection) => {
      // The ungrouped case draws no header: `groupByAisle` collapses to one
      // unlabelled group when grouping would gain nothing, and a checklist is
      // never grouped. It is still a section, so an item dragged up out of the
      // cart has somewhere to land.
      if (!section.title) return <View />;
      const color = headerColors.get(section.key);
      return (
        <View style={sectionHeaderStyles.container}>
          {color ? (
            <View
              style={[sectionHeaderStyles.dot, { backgroundColor: color }]}
            />
          ) : null}
          <Text style={sectionHeaderStyles.text}>{section.title}</Text>
          <SectionCount value={section.data.length} />
        </View>
      );
    },
    [headerColors]
  );

  /*
    The row's callbacks take the item, so every row gets the same two
    functions and `ListItemRow`'s memo holds across renders that do not touch
    that row.
  */
  const openItem = useCallback((item: Task) => setEditing(item), []);
  // Ticking writes to the pantry, so the drawer has to reload. The write is
  // fire-and-forget inside `TasksApi.update`, so this is a refetch rather than
  // an optimistic patch: the client does not know what the gap arithmetic
  // decided.
  const onItemToggled = useCallback(
    (item: Task) => {
      if (shopping && item.project_id) invalidatePantry(item.project_id);
    },
    [shopping]
  );

  const renderItem = useCallback(
    (item: Task, drag: () => void, isActive: boolean) => (
      <View style={isActive ? styles.activeRow : undefined}>
        <ListItemRow
          item={item}
          aisle={itemAisles.get(item.id) ?? null}
          shopping={shopping}
          // Which list the row came from, said only where rows come from
          // more than one.
          listName={
            combined && item.project_id
              ? listNames.get(item.project_id)
              : undefined
          }
          onOpen={openItem}
          onDragStart={drag}
          onToggled={onItemToggled}
          pending={isPendingItem(item.id)}
        />
      </View>
    ),
    [itemAisles, shopping, combined, listNames, openItem, onItemToggled]
  );

  // Only a shopping list has an aisle or a store to correct. A stand-in row
  // has no id to correct yet.
  const onHold = useMemo(
    () =>
      shopping
        ? (item: Task) => {
            if (!isPendingItem(item.id)) setPickingId(item.id);
          }
        : undefined,
    [shopping]
  );

  /*
    The native header's options. Memoised, because expo-router hands them to
    `navigation.setOptions` whenever the object changes identity, and the
    header then redraws.
  */
  const hasGot = got.length > 0;
  const screenOptions = useMemo(
    () => ({
      title,
      // The ring goes in the title, never in `headerLeft`: overriding that
      // slot replaces the back button, and the only ways out left are the
      // edge swipe and the tab, neither of which the screen says anything
      // about. Same shape as the project screen.
      headerTitle: () => (
        <View style={styles.headerTitle}>
          {combined ? (
            // The accent rather than a list's colour: this view is every
            // shopping list, so no one list's colour would be right.
            <View style={[styles.ring, { backgroundColor: '#6366f1' }]}>
              <Ionicons name="cart" size={12} color="#ffffff" />
            </View>
          ) : list ? (
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
          {hasGot && (
            /*
              "Put away", not "Clear bought". The write is the same — items
              are still soft-deleted — but nothing important is lost,
              because each was recorded in the pantry when it was ticked.
              That is why it stays one unconfirmed tap.
            */
            <Pressable onPress={onClear} hitSlop={10}>
              <Text style={styles.clear}>{copy.clear}</Text>
            </Pressable>
          )}
          {combined ? (
            /*
              The combined view has no edit sheet, so the slot the pencil
              takes on a list is where its "Add to Home screen" goes. On a
              list that button lives in the edit sheet, with the other
              once-per-list answers. Android only: an iOS app cannot put an
              icon on the home screen.
            */
            Platform.OS === 'android' ? (
              <Pressable
                onPress={() => void pinCombined()}
                hitSlop={10}
                accessibilityLabel={`Add ${ALL_SHOPPING_NAME} to the home screen`}
              >
                <Ionicons
                  name="phone-portrait-outline"
                  size={20}
                  color="#6366f1"
                />
              </Pressable>
            ) : null
          ) : (
            /* The list's name, icon and colour were only settable at the
               moment it was created. This is the way back to them, and the
               only way to delete a list from the phone. */
            <Pressable
              onPress={() => {
                // Not before the row has loaded: with no list the form
                // would open as "New list".
                if (!list) return;
                openProjectForm({
                  project: list,
                  // The deleted list is this screen, so there is nothing
                  // left to show.
                  onDeleted: () => router.back(),
                });
              }}
              hitSlop={10}
              accessibilityLabel="Edit list"
            >
              <Ionicons name="create-outline" size={21} color="#6366f1" />
            </Pressable>
          )}
        </View>
      ),
    }),
    [title, combined, list, hasGot, onClear, copy, pinCombined, router]
  );

  /*
    Above the list rather than inside the drawer. This is a prompt about the
    trip you are about to make, not a record of past ones, so it has to be
    seen before shopping rather than found afterwards.
  */
  const listHeader = useMemo(
    () =>
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
      ) : null,
    [due, putBack]
  );

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor="#6366f1"
      />
    ),
    [refreshing, onRefresh]
  );

  const listName = list?.name;
  const listEmpty = useMemo(
    () =>
      loadState.showSkeleton ? (
        <ListSkeleton rows={5} />
      ) : loadState.showError ? (
        <ListError onRetry={refetch} />
      ) : combined && shopLists.length === 0 ? (
        // Reachable from a pinned icon after the last shopping list went.
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No shopping lists</Text>
          <Text style={styles.emptyHint}>
            Turn on Shopping list in a list's settings and its items show up
            here.
          </Text>
        </View>
      ) : combined ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Nothing to buy</Text>
          <Text style={styles.emptyHint}>
            Tap + to add to any of your shopping lists.
          </Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Nothing on this list</Text>
          <Text style={styles.emptyHint}>
            Tap + to add one, or add from anywhere with #
            {(listName ?? '').toLowerCase().replace(/\s+/g, '')}
          </Text>
        </View>
      ),
    [
      loadState.showSkeleton,
      loadState.showError,
      refetch,
      combined,
      shopLists.length,
      listName,
    ]
  );

  /*
    The pantry sits under the list as its footer. It is where the list came
    from, so scrolling past what is left to buy to reach it is the right
    order. A separate tab would turn putting one item back into a navigation.
  */
  const listFooter = useMemo(
    () =>
      pantryCount > 0 ? (
        <View style={styles.pantry}>
          <Text style={styles.pantryHeader}>Bought before · {pantryCount}</Text>
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
      ) : null,
    [pantryCount, bands, putBack, forget]
  );

  /*
    The regroup at `AISLE_GROUP_MIN_ITEMS`. Below six open items the list is
    one unlabelled group; at six it splits into aisles under headers, and
    every row moves at once. The new layout fades up from a dim copy of
    itself so the jump reads as a change of view rather than a glitch.

    An opacity on a wrapper is the one thing that can be animated here without
    touching the drag layer. `SectionedDraggableList` positions its cells
    itself, and a layout transition on them would fight that. This is not a
    true crossfade: the old layout is gone on the frame the new one draws.

    Not on the first load, which is not a change, and not under Reduce Motion.
  */
  const grouped = sections.some((s) => s.key !== GOT_SECTION && s.title !== '');
  const loaded = itemsQuery.data !== undefined;
  const wasGrouped = useRef<boolean | null>(null);
  const listOpacity = useSharedValue(1);
  useLayoutEffect(() => {
    if (!loaded) return;
    const before = wasGrouped.current;
    wasGrouped.current = grouped;
    if (before === null || before === grouped || prefersReducedMotion()) return;
    listOpacity.value = withSequence(
      withTiming(REGROUP_FROM_OPACITY, { duration: 0 }),
      withTiming(1, { duration: REGROUP_MS, easing: Easing.out(Easing.quad) })
    );
  }, [loaded, grouped, listOpacity]);
  const listFadeStyle = useAnimatedStyle(() => ({
    opacity: listOpacity.value,
  }));

  return (
    <View style={styles.container}>
      <Stack.Screen options={screenOptions} />
      <UpdatingBar visible={loadState.showUpdating} />

      <Text style={styles.subline}>{listSubline(summary, { shopping })}</Text>

      <Animated.View style={[styles.listWrap, listFadeStyle]}>
        <SectionedDraggableList
          sections={sections}
          /*
            The key carries which side of the list the row is on, not just its
            id.

            A row plays a collapse on its way out — `ListItemRow` shrinks its
            own height so the rows below travel up — and then the cache patch
            moves it between the aisles and "Got it". Keyed by id alone, React
            reconciles those as the *same* element whenever the row lands at
            the same index in the flattened list, so the instance survives with
            its exit state still collapsed and the row is drawn at zero height
            in its new section. With one item on the list that is every time:
            a "Got it · 1" header over nothing at all.

            Changing the key on the move forces a remount, which is also what
            the row is: a fresh row, at full height, in a different place.
          */
          rowKey={itemRowKey}
          renderHeader={renderHeader}
          renderTask={renderItem}
          onReorder={onReorder}
          onMove={onMove}
          onHold={onHold}
          ListHeaderComponent={listHeader}
          refreshControl={refreshControl}
          ListEmptyComponent={listEmpty}
          // The list adds the floating tab bar's height to this itself. See
          // `useTabBarScrollSync`.
          contentContainerStyle={styles.listContent}
          ListFooterComponent={listFooter}
        />
      </Animated.View>

      {/*
        The same button the task screens use. `onPress` opens this screen's
        composer instead of the task composer; see the note at the top.

        Absent when there is no list to add to: All shopping with no shopping
        lists, whose empty state says how to get one.

        It fades out as the composer opens and back in as it closes. The fade
        is on a full-screen wrapper because the button positions itself and
        moves with the tab bar, and a layout animation must not sit on a view
        whose transform something else drives. `skipEntering` keeps it from
        fading in when the screen first opens.
      */}
      <LayoutAnimationConfig skipEntering>
        {composerOpen || !chosenTarget ? null : (
          <Animated.View
            style={StyleSheet.absoluteFill}
            pointerEvents="box-none"
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(120)}
          >
            <QuickAddButton onPress={openComposer} />
          </Animated.View>
        )}
      </LayoutAnimationConfig>

      {composerMounted ? (
        <ListComposer
          key={composerSession}
          open={composerOpen}
          shown={composerShown}
          liftStyle={liftStyle}
          restingGap={restingGap}
          combined={combined}
          shopping={shopping}
          placeholder={copy.placeholder}
          shopLists={shopLists}
          chosenTarget={chosenTarget}
          items={items}
          stores={stores}
          pantry={pantry}
          onAdd={addItem}
          onChooseTarget={chooseTarget}
          onClose={closeComposer}
        />
      ) : null}

      <ItemSheet
        item={shopping ? picking : null}
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
    </View>
  );
}

/**
 * The list composer: the suggestion strips, the list pills and the field.
 *
 * Its own component so that typing re-renders only this. The text, the
 * "N added" receipt, and everything read off the text (the `@store`
 * autocomplete, the pantry search, which pill is lit) live here. The screen
 * above holds none of it, so a keystroke no longer redraws the header, the
 * rows or the pantry drawer.
 *
 * Rendered inline, not in a `Modal`: on Android a Modal opens a new window
 * and closes the keyboard. Tapping the dimmed area closes the sheet. The card
 * and its suggestion strips move with the keyboard together. The strips sit
 * above the card, because the card sits directly on the keyboard.
 *
 * Two views move the card, and they must stay separate. The outer one follows
 * the keyboard (`liftStyle`). The inner one plays the entrance and exit off
 * `shown`. Putting both on one transform would make each overwrite the other.
 */
function ListComposer({
  open,
  shown,
  liftStyle,
  restingGap,
  combined,
  shopping,
  placeholder,
  shopLists,
  chosenTarget,
  items,
  stores,
  pantry,
  onAdd,
  onChooseTarget,
  onClose,
}: {
  /** False while the exit plays. The sheet stops taking touches at once. */
  open: boolean;
  /** 0 closed, 1 open. Owned by the screen, which unmounts this at 0. */
  shown: SharedValue<number>;
  liftStyle: ReturnType<typeof useAnimatedStyle>;
  restingGap: number;
  combined: boolean;
  shopping: boolean;
  placeholder: string;
  shopLists: Project[];
  chosenTarget: string | null;
  items: Task[];
  stores: string[];
  pantry: PantryEntry[];
  onAdd: (target: string, input: NewItem) => Promise<unknown>;
  onChooseTarget: (id: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [added, setAdded] = useState(0);
  // What moves the action glyph to the trailing edge. Text counts as well
  // as focus: a half-typed item the keyboard has been dismissed over still
  // has something to commit.
  const [focused, setFocused] = useState(false);
  // The glyph travels the field's width, so the field has to report it.
  const [width, setWidth] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const toast = useUndoToast();

  /*
    The list a new item would go to right now. In the combined view a typed
    `#household` beats the chip, the same precedence quick-add gives a typed
    `#project` over the page it was typed on. The chip shows it, so the
    pill lit up is always where Enter would send the item.
  */
  const routedDraft = combined
    ? extractListToken(draft, shopLists)
    : { text: draft, list: null };
  const destination = routedDraft.list?.id ?? chosenTarget;
  /** The item name `submit` would write, for the return key's armed state. */
  const draftTitle = shopping
    ? extractStoreTokens(routedDraft.text).title
    : routedDraft.text.trim();
  // What the composer is typing after an `@`, or null if no token is open. An
  // empty string is a real answer: a bare `@` opens the full list.
  //
  // A checklist has no stores, so `@` is just a character there.
  const storeQuery = shopping ? typingStoreToken(draft) : null;
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
    Commits one item. The row, the haptic and the "N added" count all land on
    this frame, because `addListItem` is optimistic. A failed write takes the
    count back and says which item did not go in.
  */
  const commit = useCallback(
    async (target: string, input: NewItem, typed: string) => {
      setAdded((n) => n + 1);
      hapticLight();
      try {
        await onAdd(target, input);
      } catch {
        setAdded((n) => Math.max(0, n - 1));
        // Restore exactly what they typed, every `@store` and `#list`
        // included, unless they have already started the next item: the
        // burst moved on, and overwriting it would lose that word instead.
        // Rebuilding it from the parsed parts would silently drop one of them
        // when the network fails.
        if (typed) setDraft((current) => (current === '' ? typed : current));
        toast.show({ message: `Couldn't add ${input.title} — try again` });
      }
    },
    [onAdd, toast]
  );

  const submit = useCallback(() => {
    const typedDraft = draft;
    // In the combined view a `#list` token picks the list and comes out of the
    // title. Taken out first, because the store run below reaches the end of
    // the line and would otherwise swallow it.
    const routed = combined
      ? extractListToken(typedDraft, shopLists)
      : { text: typedDraft, list: null };
    const target = routed.list?.id ?? chosenTarget;
    // `@` names a store, the way `#` names a project. See `extractStoreTokens`
    // for why only the list composers parse it, not `parseTaskInput`. Only a
    // shopping list has stores.
    const { title, stores: typed } = shopping
      ? extractStoreTokens(routed.text)
      : { title: routed.text.trim(), stores: [] as string[] };
    if (!title || !target) return;
    // Cleared before the write, never after: the field has to be ready for the
    // next word on the same frame, which is what a burst composer is for.
    // `blurOnSubmit={false}` keeps the keyboard up with it.
    setDraft('');
    // The pill moves with the item, so the rest of the burst goes there too.
    if (combined) onChooseTarget(target);
    void commit(
      target,
      { title, ...(typed.length > 0 ? { tags: typed.map(storeTag) } : {}) },
      typedDraft
    );
  }, [draft, combined, shopLists, chosenTarget, shopping, onChooseTarget, commit]);

  /** A pantry chip: puts the item back with its stores, and clears the field. */
  const putBack = useCallback(
    (entry: PantryEntry) => {
      if (!chosenTarget) return;
      setDraft('');
      void commit(chosenTarget, pantryInput(entry), '');
    },
    [chosenTarget, commit]
  );

  const scrimStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * COMPOSER_SLIDE_PX }],
  }));

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={open ? 'box-none' : 'none'}
      // Gone for a screen reader as soon as it starts to close.
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
    >
      <Animated.View style={[styles.composerScrim, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close the composer"
        />
      </Animated.View>
      <Animated.View
        style={[styles.composerDock, { paddingBottom: restingGap }, liftStyle]}
        pointerEvents="box-none"
      >
        <Animated.View style={cardStyle} pointerEvents="box-none">
          {/*
            The composer's memory: a few keystrokes to put back something
            bought repeatedly, with its store attached. Tapping adds it
            directly rather than completing the field, since a confirm step
            would undo the speed.
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
                    putBack(entry);
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

          {/*
            The stores already on this list, offered while an `@` token is
            open. A horizontal strip rather than a dropdown, so it sits
            directly over the field where the thumb already is. It pushes
            nothing around, since the row only exists while a token is open.
          */}
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
                    setDraft((current) => applyStoreToken(current, name));
                    // Keep focus so the next item can be typed straight away.
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

          {/*
            Which list the item goes to, in the combined view only. One pill
            per shopping list rather than a picker: there are usually two or
            three, and a pill row says where the item is going before Enter
            rather than after. A typed `#household` lights its pill, because
            that is where the item would land.

            Directly above the field, under the suggestion strips, so it does
            not move when a strip opens.
          */}
          {combined && shopLists.length > 0 && (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              style={[styles.storeStrip, styles.targetStrip]}
              contentContainerStyle={styles.storeStripInner}
            >
              {shopLists.map((l) => {
                const selected = l.id === destination;
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => {
                      onChooseTarget(l.id);
                      inputRef.current?.focus();
                    }}
                    style={({ pressed }) => [
                      styles.targetPill,
                      selected && styles.targetPillSelected,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Add to ${l.name}`}
                  >
                    <View
                      style={[styles.targetDot, { backgroundColor: l.color }]}
                    />
                    <Text
                      style={[
                        styles.targetText,
                        selected && styles.targetTextSelected,
                      ]}
                    >
                      {l.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View
            style={styles.composer}
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          >
            <ComposerActionGlyph
              width={width}
              active={focused || draft.length > 0}
              // The same test `submit` guards on, so the return key is live
              // exactly when pressing it would write something.
              armed={draftTitle.length > 0 && !!destination}
              onSubmit={submit}
              onFocusField={() => inputRef.current?.focus()}
              idleLabel="Add an item"
              submitLabel="Add this item"
            />
            {/* The field keeps clear of both gutters at all times, so the
                glyph has somewhere to sit at either end and the "N added"
                receipt never lands under it. */}
            <View style={styles.composerField}>
              <TextInput
                ref={inputRef}
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={submit}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                // The field mounts when the sheet opens, so autoFocus
                // raises the keyboard as soon as the plus is tapped.
                autoFocus
                // The two props that make this a burst rather than one item:
                // the keyboard stays up, and return commits instead of
                // dismissing.
                blurOnSubmit={false}
                returnKeyType="done"
                submitBehavior="submit"
                placeholder={placeholder}
                placeholderTextColor="#9ca3af"
                style={styles.input}
              />
              {added > 0 && <Text style={styles.added}>{added} added</Text>}
            </View>
          </View>
        </Animated.View>
      </Animated.View>
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
 * The long press also picks the row up for a drag, so the sheet opens when the
 * row is put down without moving. Dragging covers the aisles already on screen.
 * This sheet is still the only way to file an item into an aisle the list has
 * nothing in, and the only way to change its shops.
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
  listWrap: { flex: 1 },
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
  // Dims the list behind the sheet. Tapping it closes the sheet.
  composerScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,24,39,0.4)',
  },
  // Pinned to the bottom, outside the list's layout, and moved by the keyboard.
  composerDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: GLYPH_PAD,
    paddingVertical: 10,
    borderRadius: 12,
    // A shadow separates the white card from the dimmed list behind it.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
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
  storeStrip: { flexGrow: 0 },
  storeStripInner: { paddingHorizontal: 12, gap: 8 },
  storeChip: {
    backgroundColor: '#eef0fe',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  storeChipText: { fontSize: 13, fontWeight: '600', color: '#4338ca' },
  // The combined composer's list pills. White at rest like a pantry chip, and
  // outlined in the accent when it is where Enter would send the item.
  // Spaced from a suggestion strip above it, which sits flush on whatever is
  // below.
  targetStrip: { marginTop: 8 },
  targetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  targetPillSelected: { borderColor: '#6366f1', backgroundColor: '#eef0fe' },
  targetDot: { width: 8, height: 8, borderRadius: 4 },
  targetText: { fontSize: 13, fontWeight: '600', color: '#4b5563' },
  targetTextSelected: { color: '#4338ca' },
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
  // The row being dragged. The same lift every task list gives a held row.
  activeRow: { opacity: 0.9, backgroundColor: '#f1f5f9' },
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
