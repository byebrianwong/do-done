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
 */

import React, { useEffect, useState } from 'react';
import type {
  RefreshControlProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import DraggableFlatList, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import type { Task } from '@do-done/shared';

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
    isActive: boolean
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
}

export default function SectionedDraggableList({
  sections,
  renderHeader,
  renderTask,
  onReorder,
  onMove,
  refreshControl,
  contentContainerStyle,
}: Props) {
  const [rows, setRows] = useState<Row[]>(() => flatten(sections));

  const sig = sections
    .map((s) => `${s.key}#${s.data.map((t) => t.id).join(',')}`)
    .join('|');
  useEffect(() => {
    setRows(flatten(sections));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  function handleDragEnd({ data, to }: { data: Row[]; from: number; to: number }) {
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

  return (
    <DraggableFlatList
      data={rows}
      keyExtractor={(r) => r.key}
      onDragEnd={handleDragEnd}
      renderItem={({ item, drag, isActive }: RenderItemParams<Row>) =>
        item.kind === 'header'
          ? renderHeader(item.section)
          : renderTask(item.task, drag, isActive)
      }
      refreshControl={refreshControl}
      contentContainerStyle={contentContainerStyle}
    />
  );
}
