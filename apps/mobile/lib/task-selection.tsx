import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { usePathname } from 'expo-router';

/**
 * Multi-select state for task rows — the foundation for mobile bulk actions.
 *
 * Selection is an **explicit mode**, armed from a list's ⋯ menu and left with
 * Done. It used to be entered by long-pressing a row, which is why the row
 * carried a grab handle: the hold was taken, so reordering had nowhere else to
 * go. The handle cost every row on every screen ~36px so that the rarer of the
 * two actions could keep the cheaper gesture. Now the hold reorders (see
 * `lib/row-gesture.ts`) and this mode is asked for.
 *
 * That is also why "armed" is its own flag rather than `selectedIds.size > 0`.
 * The menu arms the mode with nothing picked yet — under the old derivation
 * that state was indistinguishable from "not selecting", so the rows would not
 * have become targets and the first tap would have opened the editor.
 *
 * While the mode is armed a row tap toggles it instead of opening the editor,
 * the leading control becomes a selection checkbox, and the bulk-action toolbar
 * takes over the bottom bar.
 */
export interface TaskSelectionValue {
  selectedIds: ReadonlySet<string>;
  count: number;
  /** True while selection mode is armed — with or without anything picked. */
  isActive: boolean;
  isSelected: (id: string) => boolean;
  /** Arm the mode with nothing selected. The ⋯ menu's "Select tasks". */
  begin: () => void;
  toggle: (id: string) => void;
  /** Deselect everything and leave the mode. */
  end: () => void;
}

const EMPTY: ReadonlySet<string> = new Set<string>();

// Components rendered outside a provider get an inert selection — mirrors
// useUndoToast, so a bare <TaskItem/> never has to be wrapped just to render.
const NOOP: TaskSelectionValue = {
  selectedIds: EMPTY,
  count: 0,
  isActive: false,
  isSelected: () => false,
  begin: () => {},
  toggle: () => {},
  end: () => {},
};

const TaskSelectionContext = createContext<TaskSelectionValue | null>(null);

export function TaskSelectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set<string>()
  );

  const begin = useCallback(() => setActive(true), []);

  const toggle = useCallback((id: string) => {
    // Arms the mode as well, so a caller that selects a row directly can't end
    // up with a picked row and no way to see or act on it.
    setActive(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const end = useCallback(() => {
    setActive(false);
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set<string>()));
  }, []);

  // Switching tabs/screens starts a fresh selection — a lingering "3 selected"
  // that referred to another screen's rows would be a footgun, and an armed
  // mode carried onto a screen the user navigated to would swallow their first
  // tap. Adjusting state during render is the React-endorsed alternative to a
  // clear-in-effect.
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (active) setActive(false);
    if (selectedIds.size > 0) setSelectedIds(new Set<string>());
  }

  const value = useMemo<TaskSelectionValue>(
    () => ({
      selectedIds,
      count: selectedIds.size,
      isActive: active,
      isSelected: (id: string) => selectedIds.has(id),
      begin,
      toggle,
      end,
    }),
    [active, selectedIds, begin, toggle, end]
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
