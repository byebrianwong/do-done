/**
 * A single DraggableFlatList that supports dragging items BETWEEN sections.
 *
 * react-native-draggable-flatlist can't drag an item from one list into another,
 * so instead we flatten sections + their headers into one list. Headers are
 * non-draggable anchor rows; on drop we find the nearest preceding header to
 * learn the item's new section, then let the parent persist the move (e.g.
 * change a task's date or status) and the new in-section order.
 *
 * Sections drive an internal `rows` copy that updates optimistically on drop
 * (no snap-back) and re-syncs whenever the `sections` prop changes (after the
 * mutation reconciles through the query cache).
 *
 * It is also where the minimizing tab bar is fed, because it is the one door
 * every task list on a tab goes through — Today and Upcoming render it
 * directly, Inbox and All reach it via `GroupedTaskList`. Wiring it here
 * rather than at each screen is the difference between one call site and five
 * that can drift. `useTabBarScrollSync` answers with nothing on a screen that
 * has no tab bar under it (a pushed project, a tag, Completed), so the same
 * list is inert there without knowing where it is mounted.
 */

import React, { useEffect, useMemo, useState } from 'react';
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

import { useTabBarScrollSync } from '@/lib/tab-bar-minimize';

export type DraggableSection = { key: string; title: string; data: Task[] };

type Row =
  | { kind: 'header'; key: string; section: DraggableSection }
  | { kind: 'task'; key: string; task: Task; sectionKey: string };

function flatten(sections: DraggableSection[]): Row[] {
  const rows: Row[] = [];
  for (const s of sections) {
    rows.push({ kind: 'header', key: `h:${s.key}`, section: s });
    for (const t of s.data) {
      rows.push({ kind: 'task', key: t.id, task: t, sectionKey: s.key });
    }
  }
  return rows;
}

function collectSectionTaskIds(rows: Row[], key: string): string[] {
  const ids: string[] = [];
  let cur: string | null = null;
  for (const r of rows) {
    if (r.kind === 'header') cur = r.section.key;
    else if (cur === key) ids.push(r.key);
  }
  return ids;
}

interface Props {
  sections: DraggableSection[];
  renderHeader: (section: DraggableSection) => React.ReactElement;
  renderTask: (
    task: Task,
    drag: () => void,
    isActive: boolean,
    /**
     * The section this row is in. The row itself can't tell, and a completion
     * that empties its section earns a celebratory burst — see `sparkReason`
     * in `@do-done/shared`.
     */
    section: DraggableSection
  ) => React.ReactElement;
  /** Reorder within one section: the section's new id order. */
  onReorder: (sectionKey: string, orderedIds: string[]) => void;
  /** Move across sections: task moved from→to, plus the dest section's new order. */
  onMove: (
    taskId: string,
    fromKey: string,
    toKey: string,
    destOrderedIds: string[]
  ) => void;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Non-draggable block rendered above all sections (e.g. Today's Overdue). */
  ListHeaderComponent?: React.ComponentProps<
    typeof DraggableFlatList
  >["ListHeaderComponent"];
  /** Shown when there are no rows at all — skeleton, error, or "nothing here". */
  ListEmptyComponent?: React.ComponentProps<
    typeof DraggableFlatList
  >["ListEmptyComponent"];
}

export default function SectionedDraggableList({
  sections,
  renderHeader,
  renderTask,
  onReorder,
  onMove,
  refreshControl,
  contentContainerStyle,
  ListHeaderComponent,
  ListEmptyComponent,
}: Props) {
  const [rows, setRows] = useState<Row[]>(() => flatten(sections));
  const tabBar = useTabBarScrollSync();

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

  // Re-sync the internal `rows` copy whenever `sections` changes. The signature
  // must cover task *content*, not just id/order: a field edit (e.g. changing a
  // task's priority) leaves membership and order identical, so an id-only
  // signature never fired this effect — the list kept rendering the pre-edit
  // task objects even after the query cache reconciled. Stringifying each task
  // makes any field change (priority, title, when, tags, …) re-seed the rows.
  const sig = sections
    .map((s) => `${s.key}#${s.data.map((t) => JSON.stringify(t)).join(',')}`)
    .join('|');
  useEffect(() => {
    setRows(flatten(sections));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  function handleDragEnd({ data, to }: { data: Row[]; from: number; to: number }) {
    tabBar.setDragging(false);
    const moved = data[to];
    if (!moved || moved.kind !== 'task') {
      setRows(data);
      return;
    }
    // The new section is the nearest header at or above the drop position.
    let newKey: string | null = null;
    for (let i = to; i >= 0; i--) {
      const r = data[i];
      if (r.kind === 'header') {
        newKey = r.section.key;
        break;
      }
    }
    if (!newKey) {
      setRows(data);
      return;
    }
    const oldKey = moved.sectionKey;
    const next = data.map((r) =>
      r.kind === 'task' && r.key === moved.key
        ? { ...r, sectionKey: newKey as string }
        : r
    );
    setRows(next);
    const destIds = collectSectionTaskIds(next, newKey);
    if (newKey === oldKey) onReorder(newKey, destIds);
    else onMove(moved.key, oldKey, newKey, destIds);
  }

  /**
   * Which rows pin to the top as you scroll past them.
   *
   * This is a flat `DraggableFlatList` — headers and tasks in one array, which
   * is what lets a task be dragged from one section into another — so
   * `SectionList`'s `stickySectionHeadersEnabled` is not available and the
   * indices have to be computed.
   *
   * **`ListHeaderComponent` occupies index 0 when present**, and
   * VirtualizedList matches these numbers against `dataIndex + stickyOffset`
   * without adding the offset itself. Forget it and every section pins the row
   * after its header — its first task instead of its name, which looks
   * deliberate enough that nobody would report it.
   *
   * Computed from `rows` rather than `sections` because `rows` is what is being
   * rendered: mid-drag it is the local copy, and a header's index moves as a
   * task crosses a section boundary.
   */
  const stickyHeaderIndices = useMemo(() => {
    const offset = ListHeaderComponent ? 1 : 0;
    const indices: number[] = [];
    rows.forEach((row, i) => {
      if (row.kind === 'header') indices.push(i + offset);
    });
    return indices;
  }, [rows, ListHeaderComponent]);

  // The authoritative section data is the `sections` prop, not the local `rows`
  // copy the drag mutates: `rows` tracks which section a row is *in* mid-gesture,
  // while this is asking what is *in* the section.
  function sectionOf(key: string): DraggableSection {
    return (
      sections.find((s) => s.key === key) ?? { key, title: '', data: [] }
    );
  }

  return (
    <DraggableFlatList
      data={rows}
      keyExtractor={(r) => r.key}
      stickyHeaderIndices={stickyHeaderIndices}
      onDragEnd={handleDragEnd}
      renderItem={({ item, drag, isActive }: RenderItemParams<Row>) =>
        item.kind === 'header'
          ? renderHeader(item.section)
          : renderTask(item.task, drag, isActive, sectionOf(item.sectionKey))
      }
      // Dragging a row near the bottom of the screen makes the library
      // auto-scroll the list, which would minimize the bar in response to a
      // movement the user did not make. The freeze can only ever *keep the bar
      // out*, so a drag whose end somehow never fires leaves the bar expanded
      // rather than stuck away.
      onDragBegin={() => tabBar.setDragging(true)}
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
    />
  );
}
