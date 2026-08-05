"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Density } from "@do-done/shared";

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

/**
 * How much vertical room the surrounding list gives each row.
 *
 * Comes down from the view's DisplayConfig rather than a prop because TaskItem
 * is rendered from a dozen call sites — the grouped list, Today's focus
 * sections, Upcoming's day columns, the drag overlay — and every one of them
 * would otherwise have to thread the same value through untouched.
 *
 * The default is "comfortable" so surfaces with no Display menu of their own
 * (the single-task page, Storybook stories, the modal's subtask list) keep the
 * roomy layout they were designed at.
 */
const DensityContext = createContext<Density>("comfortable");

export function TaskRowBehaviorProvider({
  keepsCompleted,
  density = "comfortable",
  children,
}: {
  keepsCompleted: boolean;
  density?: Density;
  children: ReactNode;
}) {
  return (
    <KeepsCompletedContext.Provider value={keepsCompleted}>
      <DensityContext.Provider value={density}>{children}</DensityContext.Provider>
    </KeepsCompletedContext.Provider>
  );
}

/** True when completing a task leaves it visible in this list. */
export function useKeepsCompleted(): boolean {
  return useContext(KeepsCompletedContext);
}

/** Row density for the current list. */
export function useRowDensity(): Density {
  return useContext(DensityContext);
}

/** True when the current list is in compact density. */
export function useIsCompact(): boolean {
  return useContext(DensityContext) === "compact";
}
