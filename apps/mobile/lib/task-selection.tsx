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
 * The mobile selection model is long-press to enter "selection mode" and tap to
 * toggle rows (there's no ⌘/Shift on touch). While a selection is active a row
 * tap toggles it instead of opening the editor, the leading control becomes a
 * selection checkbox, and a bulk-action toolbar takes over the bottom bar.
 */
export interface TaskSelectionValue {
  selectedIds: ReadonlySet<string>;
  count: number;
  /** True once anything is selected — "selection mode". */
  isActive: boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  clear: () => void;
}

const EMPTY: ReadonlySet<string> = new Set<string>();

// Components rendered outside a provider get an inert selection — mirrors
// useUndoToast, so a bare <TaskItem/> never has to be wrapped just to render.
const NOOP: TaskSelectionValue = {
  selectedIds: EMPTY,
  count: 0,
  isActive: false,
  isSelected: () => false,
  toggle: () => {},
  clear: () => {},
};

const TaskSelectionContext = createContext<TaskSelectionValue | null>(null);

export function TaskSelectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set<string>()
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set<string>()));
  }, []);

  // Switching tabs/screens starts a fresh selection — a lingering "3 selected"
  // that referred to another screen's rows would be a footgun. Adjusting state
  // during render is the React-endorsed alternative to a clear-in-effect.
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (selectedIds.size > 0) setSelectedIds(new Set<string>());
  }

  const value = useMemo<TaskSelectionValue>(
    () => ({
      selectedIds,
      count: selectedIds.size,
      isActive: selectedIds.size > 0,
      isSelected: (id: string) => selectedIds.has(id),
      toggle,
      clear,
    }),
    [selectedIds, toggle, clear]
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
