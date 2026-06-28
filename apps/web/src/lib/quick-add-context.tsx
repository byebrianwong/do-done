"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { Project } from "@do-done/shared";

interface QuickAddContextValue {
  /** Server projects plus any created inline this session (merged). */
  projects: Project[];
  /** The signed-in user, or null. The Project chip needs this to create. */
  userId: string | null;
  /** Register a project created inline so every quick-add surface sees it. */
  addProject: (project: Project) => void;
}

/**
 * Default value so surfaces work without a provider (Storybook, tests): no
 * projects, no user → the Project chip is simply omitted.
 */
const QuickAddContext = createContext<QuickAddContextValue>({
  projects: [],
  userId: null,
  addProject: () => {},
});

/**
 * Supplies `projects` + `userId` to every quick-add surface (top bar,
 * per-section composer, modal) without prop-drilling through the view tree.
 * Mounted once at the authenticated app layout.
 */
export function QuickAddProvider({
  projects,
  userId,
  children,
}: {
  projects: Project[];
  userId: string | null;
  children: React.ReactNode;
}) {
  const [created, setCreated] = useState<Project[]>([]);
  const addProject = useCallback(
    (project: Project) => setCreated((prev) => [...prev, project]),
    []
  );
  const value = useMemo<QuickAddContextValue>(
    () => ({ projects: [...projects, ...created], userId, addProject }),
    [projects, created, userId, addProject]
  );
  return (
    <QuickAddContext.Provider value={value}>
      {children}
    </QuickAddContext.Provider>
  );
}

export function useQuickAddContext() {
  return useContext(QuickAddContext);
}
