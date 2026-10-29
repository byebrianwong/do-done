/**
 * What should animate when a sectioned list changes shape for a reason that is
 * not a write: a section folded shut or opened, a task moving from one section
 * to another (Today's Other tasks up into Focus), a group header whose last
 * task just left.
 *
 * Each of these used to swap rows in one frame. A row that leaves the data is
 * gone on the next render, so the only way to fold it shut is to keep drawing
 * it for the length of the fold: a **ghost**. A row that joins the data mounts
 * fresh, so it can be told to open up: an **arrival**.
 *
 * `draggable-flatlist` has layout animations of its own, and they are not used
 * for this. Its `enableLayoutAnimationExperimental` path reads
 * `global.LayoutAnimationRepository`, which Reanimated 4 no longer has, so
 * turning it on would throw on the UI thread. Its `itemEnteringAnimation`
 * plays on every cell mount, which includes every row the list draws again as
 * it scrolls back into view. Animating each row's own height (`useRowExit`)
 * needs nothing from the list, the same reason the completion exit does it
 * that way.
 *
 * Pure, so the node suite covers it. `use-section-transitions.ts` is the hook.
 */

import type { Task } from '@do-done/shared';
import type { DraggableSection } from './section-rows';

/** A row kept on screen while it folds shut. */
export interface GhostRow {
  sectionKey: string;
  task: Task;
  /** Where it was in its section, so it folds where it stood. */
  index: number;
}

/** A section header kept on screen while it folds shut. */
export interface GhostSection {
  section: DraggableSection;
  /** Where it was among the sections. */
  index: number;
}

export interface TransitionPlan {
  ghostRows: GhostRow[];
  ghostSections: GhostSection[];
  /** `rowId(sectionKey, taskId)` of rows that should open up as they mount. */
  arriving: ReadonlySet<string>;
}

export const NO_TRANSITIONS: TransitionPlan = {
  ghostRows: [],
  ghostSections: [],
  arriving: new Set(),
};

export function rowId(sectionKey: string, taskId: string): string {
  return `${sectionKey}\n${taskId}`;
}

export interface PlanOptions {
  /** Section keys collapsed before this change. */
  collapsedBefore: ReadonlySet<string>;
  /** Section keys collapsed after it. */
  collapsedAfter: ReadonlySet<string>;
  /**
   * Animate a task that moved between sections. Only for a list whose rows
   * are keyed per section (Today), since the departing ghost and the arriving
   * row are the same task and would otherwise share a React key.
   */
  trackMoves?: boolean;
  /**
   * Tasks the user just dragged. A drop already put the row where it landed,
   * so it moving section in the data is not news.
   */
  dragged?: ReadonlySet<string>;
  /**
   * Fold a section header away when the section leaves the list. For a list
   * that hides its empty groups, where that is what the last task leaving
   * looks like.
   */
  foldRemovedSections?: boolean;
}

/**
 * Compare what the list drew before with what it is about to draw.
 *
 * Both arguments are the *drawn* sections: a collapsed section with its rows
 * already taken out. A section has to exist on both sides for its collapse to
 * mean anything; a section that is new to the list does not open, it is
 * simply there.
 */
export function planTransitions(
  before: DraggableSection[],
  after: DraggableSection[],
  opts: PlanOptions
): TransitionPlan {
  const ghostRows: GhostRow[] = [];
  const ghostSections: GhostSection[] = [];
  const arriving = new Set<string>();

  const beforeByKey = new Map(before.map((s) => [s.key, s]));
  const afterByKey = new Map(after.map((s) => [s.key, s]));
  const toggled = new Set<string>();

  for (const s of after) {
    const was = beforeByKey.get(s.key);
    if (!was) continue;
    const wasCollapsed = opts.collapsedBefore.has(s.key);
    const isCollapsed = opts.collapsedAfter.has(s.key);
    if (!wasCollapsed && isCollapsed) {
      toggled.add(s.key);
      was.data.forEach((task, index) =>
        ghostRows.push({ sectionKey: s.key, task, index })
      );
    } else if (wasCollapsed && !isCollapsed) {
      toggled.add(s.key);
      for (const t of s.data) arriving.add(rowId(s.key, t.id));
    }
  }

  if (opts.trackMoves) {
    const placeBefore = new Map<string, { key: string; index: number; task: Task }>();
    for (const s of before) {
      if (toggled.has(s.key)) continue;
      s.data.forEach((task, index) =>
        placeBefore.set(task.id, { key: s.key, index, task })
      );
    }
    for (const s of after) {
      if (toggled.has(s.key)) continue;
      for (const t of s.data) {
        const was = placeBefore.get(t.id);
        if (!was || was.key === s.key) continue;
        if (opts.dragged?.has(t.id)) continue;
        // The section it left is still drawn, so there is somewhere to fold.
        if (!afterByKey.has(was.key)) continue;
        ghostRows.push({ sectionKey: was.key, task: was.task, index: was.index });
        arriving.add(rowId(s.key, t.id));
      }
    }
  }

  if (opts.foldRemovedSections) {
    // Only removals. A change that also adds sections is a regroup or a new
    // filter, where folding the old headers away beside the new ones would be
    // two layouts on screen at once.
    const onlyRemovals = after.every((s) => beforeByKey.has(s.key));
    if (onlyRemovals) {
      let kept = 0;
      for (const s of before) {
        if (afterByKey.has(s.key)) {
          kept++;
          continue;
        }
        // The header alone. Its rows have either played their own exit by now
        // or have nothing to fold from.
        ghostSections.push({ section: { ...s, data: [] }, index: kept });
      }
    }
  }

  return { ghostRows, ghostSections, arriving };
}

/**
 * Keep the ghosts of an earlier plan that are still folding, unless the data
 * has brought the real thing back. A section opened again before it finished
 * closing has its rows again, and a ghost beside them would be a duplicate.
 */
export function carryGhosts(
  previous: TransitionPlan,
  next: TransitionPlan,
  after: DraggableSection[]
): TransitionPlan {
  const present = new Set<string>();
  for (const s of after) for (const t of s.data) present.add(rowId(s.key, t.id));
  const keys = new Set(after.map((s) => s.key));
  const seen = new Set(next.ghostRows.map((g) => rowId(g.sectionKey, g.task.id)));
  const seenSections = new Set(next.ghostSections.map((g) => g.section.key));

  const rows = [
    ...next.ghostRows,
    ...previous.ghostRows.filter((g) => {
      const id = rowId(g.sectionKey, g.task.id);
      return !present.has(id) && !seen.has(id) && keys.has(g.sectionKey);
    }),
  ];
  const sections = [
    ...next.ghostSections,
    ...previous.ghostSections.filter(
      (g) => !keys.has(g.section.key) && !seenSections.has(g.section.key)
    ),
  ];
  return { ghostRows: rows, ghostSections: sections, arriving: next.arriving };
}

/** The sections to draw: the real ones with the ghosts put back where they stood. */
export function withGhosts(
  after: DraggableSection[],
  plan: TransitionPlan
): DraggableSection[] {
  if (plan.ghostRows.length === 0 && plan.ghostSections.length === 0) {
    return after;
  }
  const out = after.map((s) => {
    const ghosts = plan.ghostRows
      .filter((g) => g.sectionKey === s.key)
      .sort((a, b) => a.index - b.index);
    if (ghosts.length === 0) return s;
    const data = [...s.data];
    for (const g of ghosts) data.splice(Math.min(g.index, data.length), 0, g.task);
    return { ...s, data };
  });
  const sections = [...plan.ghostSections].sort((a, b) => a.index - b.index);
  sections.forEach((g, i) => {
    // Each earlier insertion shifts the later ones by one.
    out.splice(Math.min(g.index + i, out.length), 0, g.section);
  });
  return out;
}

export function isEmptyPlan(plan: TransitionPlan): boolean {
  return (
    plan.ghostRows.length === 0 &&
    plan.ghostSections.length === 0 &&
    plan.arriving.size === 0
  );
}
