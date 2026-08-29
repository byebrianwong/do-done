"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Density, RowStyle, Task } from "@do-done/shared";

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

/**
 * How the surrounding list wants its rows to state their metadata.
 *
 * Threaded exactly like {@link DensityContext} and for the same reason: the row
 * is rendered from a dozen call sites and none of them should have to carry a
 * value they don't otherwise care about.
 *
 * The default is "quiet" so a surface with no Display menu of its own — the
 * single-task page, the modal's subtask list, a Storybook story — matches what
 * the lists around it draw. A row with no context is far more likely to be
 * sitting beside quiet rows than to be the one place chips are wanted.
 */
const RowStyleContext = createContext<RowStyle>("quiet");

/**
 * How many tasks are still open in the list the row sits in, and in its project.
 *
 * The row needs this for one reason only: a completion that *finishes*
 * something — empties a section, ends a project — earns the celebratory burst,
 * and a row on its own cannot possibly know that. See `sparkReason` in
 * `@do-done/shared`.
 *
 * `null` is a real and common answer, meaning "this surface can't tell": the
 * inbox and search have no sections, and the drag overlay is a floating clone
 * that must never be counted or celebrated. It is deliberately distinct from
 * `0`, so a missing provider can never be mistaken for an empty section.
 *
 * Counts are of the section *as it stood before the write* — the row's
 * completed state is optimistic and local, while these come from the server
 * props the list was rendered with, so the task being ticked off is still
 * counted among the open ones. One therefore means "this is the last".
 */
// Two contexts rather than one object, because they are published at different
// depths: the project count wraps a whole page, each section count wraps one
// section inside it. Sharing a context would mean the inner provider erased the
// outer one, and a finished project would stop being detectable the moment its
// tasks were grouped.
const SectionOpenContext = createContext<number | null>(null);
const ProjectOpenContext = createContext<number | null>(null);

function countOpen(tasks: readonly Task[]): number {
  return tasks.filter((t) => t.status !== "done" && t.status !== "cancelled")
    .length;
}

/**
 * Publishes how many tasks are still open in the section a row sits in.
 *
 * Takes the array rather than a number so call sites hand over what they
 * already have — a `DisplayGroup.tasks`, a day column, Today's focus list —
 * instead of each one reimplementing "which of these count as open".
 */
export function SectionOpenProvider({
  tasks,
  children,
}: {
  tasks: readonly Task[] | null;
  children: ReactNode;
}) {
  const count = useMemo(() => (tasks ? countOpen(tasks) : null), [tasks]);
  return (
    <SectionOpenContext.Provider value={count}>
      {children}
    </SectionOpenContext.Provider>
  );
}

/** The same, for every task in the project page a row is rendered on. */
export function ProjectOpenProvider({
  tasks,
  children,
}: {
  tasks: readonly Task[] | null;
  children: ReactNode;
}) {
  const count = useMemo(() => (tasks ? countOpen(tasks) : null), [tasks]);
  return (
    <ProjectOpenContext.Provider value={count}>
      {children}
    </ProjectOpenContext.Provider>
  );
}

/** Open tasks left in this row's section, or `null` where nothing can tell. */
export function useSectionOpenCount(): number | null {
  return useContext(SectionOpenContext);
}

/** Open tasks left in this row's project, or `null` off a project page. */
export function useProjectOpenCount(): number | null {
  return useContext(ProjectOpenContext);
}

export function TaskRowBehaviorProvider({
  keepsCompleted,
  density = "comfortable",
  rowStyle = "quiet",
  children,
}: {
  keepsCompleted: boolean;
  density?: Density;
  rowStyle?: RowStyle;
  children: ReactNode;
}) {
  return (
    <KeepsCompletedContext.Provider value={keepsCompleted}>
      <DensityContext.Provider value={density}>
        <RowStyleContext.Provider value={rowStyle}>
          {children}
        </RowStyleContext.Provider>
      </DensityContext.Provider>
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

/**
 * True when the row should state its metadata as one muted line rather than as
 * chips. See `RowStyle` in @do-done/shared for what the trade is.
 */
export function useIsQuietRow(): boolean {
  return useContext(RowStyleContext) === "quiet";
}
