"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { Task } from "@do-done/shared";

/**
 * Multi-select state for task rows — the foundation for bulk actions.
 *
 * Desktop-standard selection model: ⌘/Ctrl-click toggles a single row,
 * Shift-click selects the contiguous range from the anchor, and a plain click
 * while a selection is active toggles the clicked row (selection mode). The
 * anchor is the last row toggled/selected without Shift.
 *
 * Rows also register their `Task` object here so bulk actions that need the
 * full record (e.g. delete-with-undo, which recreates the task) can resolve it
 * from an id without threading the task list down to the floating action bar.
 */
export interface TaskSelectionValue {
  selectedIds: ReadonlySet<string>;
  count: number;
  /** True once anything is selected — "selection mode". */
  isActive: boolean;
  isSelected: (id: string) => boolean;
  /** ⌘/Ctrl-click: flip one row, and make it the range anchor. */
  toggle: (id: string) => void;
  /** Collapse the selection to a single row. */
  selectOnly: (id: string) => void;
  /** Shift-click: select anchor→toId across the given visual order. */
  selectRange: (toId: string, orderedIds: string[]) => void;
  clear: () => void;
  /** Rows call this so the bar can resolve selected ids → full Task objects. */
  registerTask: (task: Task) => void;
  unregisterTask: (id: string) => void;
  /** Snapshot of the currently-selected, currently-mounted tasks. */
  getSelectedTasks: () => Task[];
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

// Components rendered outside a provider (Storybook, unit tests, the SSR pass
// before hydration) get an inert selection — mirrors `useUndoToast`, so a bare
// <TaskItem/> never has to be wrapped just to render.
const NOOP: TaskSelectionValue = {
  selectedIds: EMPTY_SET,
  count: 0,
  isActive: false,
  isSelected: () => false,
  toggle: () => {},
  selectOnly: () => {},
  selectRange: () => {},
  clear: () => {},
  registerTask: () => {},
  unregisterTask: () => {},
  getSelectedTasks: () => [],
};

const TaskSelectionContext = createContext<TaskSelectionValue | null>(null);

/**
 * Pure range math, extracted for testability. Returns the ids from `anchorId`
 * to `toId` inclusive, in the order they appear in `orderedIds`. Falls back to
 * just `[toId]` when there's no anchor or either endpoint isn't in the list
 * (e.g. the anchor scrolled out of a filtered view).
 */
export function computeRangeSelection(
  anchorId: string | null,
  toId: string,
  orderedIds: string[]
): string[] {
  if (!anchorId) return [toId];
  const a = orderedIds.indexOf(anchorId);
  const b = orderedIds.indexOf(toId);
  if (a === -1 || b === -1) return [toId];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return orderedIds.slice(lo, hi + 1);
}

/**
 * Read the visual order of task rows straight from the DOM. Every task row
 * carries `data-task-row={id}`, so `querySelectorAll` yields them in document
 * order — which is the on-screen order across every group and list without
 * having to thread a flat ordering through React.
 */
export function orderedTaskIdsFromDom(): string[] {
  if (typeof document === "undefined") return [];
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-task-row]")
  )
    .map((el) => el.dataset.taskRow)
    .filter((v): v is string => !!v);
}

export function TaskSelectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set<string>()
  );
  // Range anchor lives in a ref: it never needs to trigger a render on its own,
  // and reading it synchronously inside selectRange avoids stale closures.
  const anchorRef = useRef<string | null>(null);
  // id → Task, populated by mounted rows. A ref (not state) so registration
  // never re-renders the tree; the bar reads it imperatively at action time.
  const tasksRef = useRef<Map<string, Task>>(new Map());

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  const selectOnly = useCallback((id: string) => {
    setSelectedIds(new Set([id]));
    anchorRef.current = id;
  }, []);

  const selectRange = useCallback((toId: string, orderedIds: string[]) => {
    const prev = anchorRef.current;
    const anchor = prev && orderedIds.includes(prev) ? prev : toId;
    anchorRef.current = anchor;
    setSelectedIds(new Set(computeRangeSelection(anchor, toId, orderedIds)));
  }, []);

  const clear = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set<string>()));
    anchorRef.current = null;
  }, []);

  const registerTask = useCallback((task: Task) => {
    tasksRef.current.set(task.id, task);
  }, []);

  const unregisterTask = useCallback((id: string) => {
    tasksRef.current.delete(id);
  }, []);

  // Navigating to another view starts a fresh selection — an on-screen "3
  // selected" that referred to the previous page's rows would be a footgun.
  // Adjusting state during render (the React-endorsed alternative to a
  // clear-in-effect) avoids an extra commit on every navigation.
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    // Only the selection needs clearing; a now-stale anchor id simply won't be
    // found in the next view's row order, so selectRange already falls back to
    // the clicked row. (Writing a ref during render is disallowed anyway.)
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set<string>()));
  }

  const value = useMemo<TaskSelectionValue>(
    () => ({
      selectedIds,
      count: selectedIds.size,
      isActive: selectedIds.size > 0,
      isSelected: (id: string) => selectedIds.has(id),
      toggle,
      selectOnly,
      selectRange,
      clear,
      registerTask,
      unregisterTask,
      getSelectedTasks: () => {
        const out: Task[] = [];
        for (const id of selectedIds) {
          const t = tasksRef.current.get(id);
          if (t) out.push(t);
        }
        return out;
      },
    }),
    [
      selectedIds,
      toggle,
      selectOnly,
      selectRange,
      clear,
      registerTask,
      unregisterTask,
    ]
  );

  return (
    <TaskSelectionContext.Provider value={value}>
      {children}
    </TaskSelectionContext.Provider>
  );
}

export function useTaskSelection(): TaskSelectionValue {
  return useContext(TaskSelectionContext) ?? NOOP;
}
