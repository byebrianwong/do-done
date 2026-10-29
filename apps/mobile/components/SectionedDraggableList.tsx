/**
 * A single DraggableFlatList that supports dragging items BETWEEN sections.
 *
 * react-native-draggable-flatlist can't drag an item from one list into another,
 * so instead we flatten sections + their headers into one list. Headers are
 * non-draggable anchor rows; on drop we find the nearest preceding header to
 * learn the item's new section, then let the parent persist the move (e.g.
 * change a task's date or status) and the new in-section order.
 *
 * The rows are derived from `sections`, keeping every row object whose task
 * did not change, so one write re-renders one cell. A drop is shown from a
 * local copy (no snap-back) until the next `sections` replaces it, after the
 * mutation reconciles through the query cache.
 *
 * It is also where the minimizing tab bar is fed, because it is the one door
 * every task list on a tab goes through — Today, Upcoming and a shopping list
 * render it directly, Inbox and All reach it via `GroupedTaskList`. Wiring it here
 * rather than at each screen is the difference between one call site and five
 * that can drift. `useTabBarScrollSync` answers with nothing on a screen that
 * has no tab bar under it (a pushed project, a tag, Completed), so the same
 * list is inert there without knowing where it is mounted.
 *
 * Whether the list is empty is decided on its tasks, not on that row count.
 * See `hasTaskRows` in `lib/section-rows.ts` for why the two differ.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RefreshControlProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { StyleSheet } from 'react-native';
import DraggableFlatList, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import type { Task } from '@do-done/shared';

import {
  flattenReusing,
  hasTaskRows,
  resolveDrop,
  stickyHeaderIndices,
  type DraggableSection,
  type Row,
} from '@/lib/section-rows';
import { useTabBarScrollSync } from '@/lib/tab-bar-minimize';

export type { DraggableSection };

/** Stable identity, so swapping to it can't churn the list on every render. */
const NO_ROWS: Row[] = [];

/**
 * How many screens of rows stay mounted: the visible one and four either side.
 *
 * VirtualizedList's default is 21, which on All kept about 250 rows mounted,
 * and every one of them paid for each re-render and each mount. Nine still
 * leaves four screens of rows ready in each direction for a fast fling and for
 * the drag library's auto-scroll.
 */
const WINDOW_SIZE = 9;
/** A phone screen of task rows and headers, so the first frame is not short. */
const INITIAL_ROWS = 16;

/** The row order, which is what the drag library compares to spot new data. */
function rowKeys(rows: Row[]): string {
  return rows.map((r) => r.key).join('\n');
}

interface Props {
  sections: DraggableSection[];
  renderHeader: (section: DraggableSection) => React.ReactElement;
  renderTask: (
    task: Task,
    drag: () => void,
    isActive: boolean,
    /**
     * The key of the section this row is in. The row itself can't tell, and a
     * completion that empties its section earns a celebratory burst — see
     * `sparkReason` in `@do-done/shared`. A key rather than the section, so a
     * row does not have to re-render when a neighbour in its section changes:
     * read the section's count at the tap (`lib/section-counts.ts`).
     */
    sectionKey: string
  ) => React.ReactElement;
  /** Reorder within one section: the section's new id order. */
  onReorder: (sectionKey: string, orderedIds: string[]) => void;
  /**
   * Move across sections: task moved from→to, plus the dest section's new order.
   *
   * Return `false` to refuse the drop, and the row goes back where it was
   * picked up. Refusing by refetching does not do this: a refetch that comes
   * back unchanged leaves `sections` unchanged, so nothing re-seeds the rows and
   * the row stays where the finger left it.
   */
  onMove: (
    taskId: string,
    fromKey: string,
    toKey: string,
    destOrderedIds: string[]
  ) => void | boolean;
  /**
   * A row picked up and put down without moving. A plain long press, in other
   * words, and the only way to give one a meaning on a list where the long
   * press starts a drag. Absent, it does nothing.
   */
  onHold?: (task: Task) => void;
  /**
   * The key React reconciles a task row on. Defaults to the task's id. Every
   * callback above is still handed ids.
   */
  rowKey?: (task: Task) => string;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Non-draggable block rendered above all sections (e.g. Today's Overdue). */
  ListHeaderComponent?: React.ComponentProps<
    typeof DraggableFlatList
  >["ListHeaderComponent"];
  /**
   * Shown when the list holds no tasks — skeleton, error, or "nothing here".
   *
   * Passing one also drops the section headers in that state, since they would
   * otherwise be a row of empty drop targets above the message with nothing to
   * drop into them. A caller that passes nothing keeps its headers, which is
   * still better than going blank.
   */
  ListEmptyComponent?: React.ComponentProps<
    typeof DraggableFlatList
  >["ListEmptyComponent"];
  /** Non-draggable block rendered below all sections (e.g. a list's pantry). */
  ListFooterComponent?: React.ComponentProps<
    typeof DraggableFlatList
  >["ListFooterComponent"];
}

function SectionedDraggableList({
  sections,
  renderHeader,
  renderTask,
  onReorder,
  onMove,
  onHold,
  rowKey,
  refreshControl,
  contentContainerStyle,
  ListHeaderComponent,
  ListEmptyComponent,
  ListFooterComponent,
}: Props) {
  const tabBar = useTabBarScrollSync();

  // Whether a row is being dragged. Section headers are not pinned while it is
  // true; see `stickyHeaderIndices` in lib/section-rows.ts for why.
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  draggingRef.current = dragging;
  // Whether the drop slot has moved during this drag, which is what tells a
  // hold from a drag that came back to where it started. See `resolveDrop`.
  const placeholderMoved = useRef(false);

  function beginDrag() {
    placeholderMoved.current = false;
    setDragging(true);
    // Dragging a row near the bottom of the screen makes the library
    // auto-scroll the list, which would minimize the bar in response to a
    // movement the user did not make. The freeze can only ever *keep the bar
    // out*, so a drag whose end somehow never fires leaves the bar expanded
    // rather than stuck away.
    tabBar.setDragging(true);
  }

  function endDrag() {
    setDragging(false);
    tabBar.setDragging(false);
  }

  // The tab bar floats over the screen rather than sitting beside it in flow,
  // so this list runs all the way to the bottom edge and has to reserve the
  // bar's own height on top of whatever bottom padding the screen asked for.
  // Added to that padding rather than replacing it: the screen's number is
  // what keeps the last row clear of the floating add button, and this one is
  // what keeps it clear of the bar. Constant, never the animated height — a
  // padding that tracked the sweep would re-measure the list every frame.
  const contentStyle = useMemo(() => {
    if (tabBar.contentInset === 0) return contentContainerStyle;
    const own = StyleSheet.flatten(contentContainerStyle) as
      | ViewStyle
      | undefined;
    const base =
      typeof own?.paddingBottom === 'number' ? own.paddingBottom : 0;
    return [
      contentContainerStyle,
      { paddingBottom: base + tabBar.contentInset },
    ];
  }, [contentContainerStyle, tabBar.contentInset]);

  // The rows, derived from `sections` during render rather than copied into
  // state by an effect. The copy cost a second render on every data change,
  // and the signature that decided when to copy ran `JSON.stringify` over
  // every task on every render (up to 500 on All).
  //
  // `flattenReusing` keeps each row object whose task is the same object as
  // last time, and hands back the previous array when nothing changed. A field
  // edit still re-seeds the rows, because the edited task is a new object even
  // when membership and order are unchanged; that is the case the old
  // signature existed for. The cells are memoised on the row object, so only
  // the rows that changed re-render.
  //
  // `rowKey` is read through a ref: callers pass it inline, and what it
  // computes depends on the task, which is already part of the comparison.
  const rowKeyRef = useRef(rowKey);
  rowKeyRef.current = rowKey;
  const seededRef = useRef<Row[]>(NO_ROWS);
  const seeded = useMemo(
    () => flattenReusing(sections, seededRef.current, rowKeyRef.current),
    [sections]
  );
  seededRef.current = seeded;

  // A drop's result, shown until the next `seeded` replaces it. Without it the
  // row would snap back to where it was picked up for the round trip the
  // write takes. Tagged with the `seeded` it was made from, so new data from
  // the cache always wins over a stale drop.
  const [dropped, setDropped] = useState<{ base: Row[]; rows: Row[] } | null>(
    null
  );
  const rows = dropped && dropped.base === seeded ? dropped.rows : seeded;

  // New row order mid-drag means the drag is over. The library cancels a drag
  // when its data's keys change, and does not call `onDragEnd` when it does,
  // so without this the headers would stay unpinned until the next drag ended.
  const committedRows = useRef(rows);
  useEffect(() => {
    const before = committedRows.current;
    committedRows.current = rows;
    if (
      before !== rows &&
      draggingRef.current &&
      rowKeys(rows) !== rowKeys(before)
    ) {
      endDrag();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  function handleDragEnd({ data, from, to }: { data: Row[]; from: number; to: number }) {
    endDrag();
    const { rows: next, result } = resolveDrop(
      data,
      from,
      to,
      placeholderMoved.current
    );
    setDropped({ base: seededRef.current, rows: next });
    switch (result.kind) {
      case 'hold':
        onHold?.(result.task);
        return;
      case 'none':
        return;
      case 'reorder':
        onReorder(result.sectionKey, result.orderedIds);
        return;
      case 'move':
        if (
          onMove(
            result.taskId,
            result.fromKey,
            result.toKey,
            result.orderedIds
          ) === false
        ) {
          // A fresh array in the original order, so the list re-renders and
          // the library lets go of the order the finger left it in.
          setDropped({ base: seededRef.current, rows: [...seededRef.current] });
        }
        return;
    }
  }

  // A list with sections but no tasks in them is empty, and has to say so.
  // Every section flattens to a header row and `applyDisplay` emits sections
  // that hold nothing, so `rows` is not empty here and DraggableFlatList's own
  // `data.length === 0` test never fires (see lib/section-rows.ts). Handing it
  // no rows at all is what lets `ListEmptyComponent` render.
  const showEmpty = ListEmptyComponent != null && !hasTaskRows(rows);
  const visibleRows = showEmpty ? NO_ROWS : rows;

  const stickyIndices = useMemo(
    () =>
      stickyHeaderIndices(visibleRows, {
        hasListHeader: ListHeaderComponent != null,
        dragging,
      }),
    [visibleRows, ListHeaderComponent, dragging]
  );

  // Stable while the caller's renderers are, so a parent re-render reaches
  // only the cells whose row object changed. The library memoises each cell on
  // `renderItem` and the item, so an inline function here re-rendered every
  // mounted cell on every render of this list.
  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<Row>) =>
      item.kind === 'header'
        ? renderHeader(item.section)
        : renderTask(item.task, drag, isActive, item.sectionKey),
    [renderHeader, renderTask]
  );

  return (
    <DraggableFlatList
      data={visibleRows}
      keyExtractor={keyExtractor}
      stickyHeaderIndices={stickyIndices}
      onDragEnd={handleDragEnd}
      renderItem={renderItem}
      windowSize={WINDOW_SIZE}
      initialNumToRender={INITIAL_ROWS}
      onDragBegin={beginDrag}
      onPlaceholderIndexChange={() => {
        placeholderMoved.current = true;
      }}
      // The library sets its own `onScroll` after spreading props, so this is
      // the only way in — and it is already hopping to JS on every frame
      // whether or not anyone listens. Undefined off a tab, where there is no
      // bar to drive.
      onScrollOffsetChange={tabBar.onScrollOffsetChange}
      // Between them these give the list's scroll range, which is the only way
      // to tell the bounce at the end of a flick from a small upward scroll.
      onContentSizeChange={tabBar.onContentSizeChange}
      onLayout={tabBar.onListLayout}
      refreshControl={refreshControl}
      contentContainerStyle={contentStyle}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
      ListFooterComponent={ListFooterComponent}
    />
  );
}

function keyExtractor(r: Row): string {
  return r.key;
}

/**
 * Memoised so a screen re-rendering for its own reasons (a sheet opening, a
 * title changing) does not re-render the list. That only helps when the
 * caller's props keep their identity, which is why the views memoise their
 * `refreshControl`, empty state and renderers.
 */
export default React.memo(SectionedDraggableList);
