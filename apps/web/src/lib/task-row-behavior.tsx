"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Does the surrounding list keep a task once it has been completed?
 *
 * A row that is about to be filtered out of its list plays the full completion
 * exit: the check springs in, the row holds for a beat reading as done, then it
 * collapses its own height so the rows below slide up into the gap.
 *
 * A row in a list that *keeps* completed tasks must not do that — it would
 * animate itself to nothing and then be re-rendered right back at full height.
 * Those surfaces (the Completed view, any view with `showCompleted` on, the
 * single-task page) wrap their rows in {@link TaskRowBehaviorProvider} with
 * `keepsCompleted`.
 *
 * The default is `false` because it matches every ordinary list — Today,
 * Upcoming, Inbox, a project — where ticking a task off is exactly the gesture
 * that removes it from view.
 */
const KeepsCompletedContext = createContext(false);

export function TaskRowBehaviorProvider({
  keepsCompleted,
  children,
}: {
  keepsCompleted: boolean;
  children: ReactNode;
}) {
  return (
    <KeepsCompletedContext.Provider value={keepsCompleted}>
      {children}
    </KeepsCompletedContext.Provider>
  );
}

/** True when completing a task leaves it visible in this list. */
export function useKeepsCompleted(): boolean {
  return useContext(KeepsCompletedContext);
}
