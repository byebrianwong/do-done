/**
 * The hook over `section-transitions.ts`: keeps the ghosts drawn for as long
 * as they take to fold, and tells each row whether it is arriving or leaving.
 *
 * No logic of its own beyond bookkeeping, because there is no renderer here to
 * test a hook with. The decisions are `planTransitions` and its neighbours.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DraggableSection } from './section-rows';
import {
  NO_TRANSITIONS,
  carryGhosts,
  isEmptyPlan,
  planTransitions,
  rowId,
  withGhosts,
  type TransitionPlan,
} from './section-transitions';
import { ROW_ARRIVE_MS, prefersReducedMotion } from './use-row-exit';

/** How long a drag stays "just dragged", covering the write's cache patch. */
const DRAGGED_MS = 3_000;

export interface SectionTransitionOptions {
  /** Section keys currently collapsed (`config.collapsed`). */
  collapsed: readonly string[];
  /**
   * Anything else about how the list is drawn (grouping, sort, filters). When
   * it changes the list is a different list, and it snaps rather than
   * animating from the old one.
   */
  resetKey: string;
  trackMoves?: boolean;
  foldRemovedSections?: boolean;
}

export interface SectionTransitions {
  /** What to hand `SectionedDraggableList`: collapsed rows out, ghosts in. */
  sections: DraggableSection[];
  /** The row should open up as it mounts. */
  isArriving: (sectionKey: string, taskId: string) => boolean;
  /** The row is a ghost: fold it shut, and don't let it be dragged or tapped. */
  isDeparting: (sectionKey: string, taskId: string) => boolean;
  /** The header is a ghost. */
  isDepartingSection: (sectionKey: string) => boolean;
  /** Call from a drop that moved a task between sections. */
  noteDragged: (taskId: string) => void;
  /** A section's ids without its ghosts, for the order a drop writes. */
  liveIds: (sectionKey: string, ids: string[]) => string[];
  /** A section's tasks without its ghosts, for counts. */
  liveData: (section: DraggableSection) => DraggableSection['data'];
}

export function useSectionTransitions(
  sections: DraggableSection[],
  opts: SectionTransitionOptions
): SectionTransitions {
  const collapsedKey = opts.collapsed.join('\n');
  const drawn = useMemo(() => {
    const collapsed = new Set(opts.collapsed);
    return sections.map((s) =>
      collapsed.has(s.key) ? { ...s, data: [] as typeof s.data } : s
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, collapsedKey]);

  const dragged = useRef(new Map<string, number>());
  const noteDragged = useCallback((taskId: string) => {
    const now = Date.now();
    for (const [id, at] of dragged.current)
      if (now - at >= DRAGGED_MS) dragged.current.delete(id);
    dragged.current.set(taskId, now);
  }, []);

  const [prev, setPrev] = useState({
    drawn,
    collapsedKey,
    resetKey: opts.resetKey,
  });
  const [plan, setPlan] = useState<TransitionPlan>(NO_TRANSITIONS);

  // Adjusted during render rather than in an effect, so the frame that drops a
  // row from the data is the frame that draws its ghost. An effect would paint
  // one frame with the row simply gone. See react.dev "adjusting state when a
  // prop changes"; `useOptimisticCompleted` does the same.
  if (prev.drawn !== drawn || prev.resetKey !== opts.resetKey) {
    let next = NO_TRANSITIONS;
    if (prev.resetKey === opts.resetKey && !prefersReducedMotion()) {
      const now = Date.now();
      const recent = new Set(
        [...dragged.current]
          .filter(([, at]) => now - at < DRAGGED_MS)
          .map(([id]) => id)
      );
      next = carryGhosts(
        plan,
        planTransitions(prev.drawn, drawn, {
          collapsedBefore: new Set(prev.collapsedKey ? prev.collapsedKey.split('\n') : []),
          collapsedAfter: new Set(opts.collapsed),
          trackMoves: opts.trackMoves,
          foldRemovedSections: opts.foldRemovedSections,
          dragged: recent,
        }),
        drawn,
        opts.trackMoves === true
      );
    }
    setPrev({ drawn, collapsedKey, resetKey: opts.resetKey });
    setPlan(next);
  }

  // Ghosts are dropped once they have folded. A frame or two of slack so the
  // last frame of the fold is drawn before the row goes; at that point it is
  // zero high, so dropping it moves nothing.
  //
  // The arrivals go at the same time. They are only read as a row mounts, and
  // a row of an opened section that mounts later than this is one the user
  // scrolled to, which must not open up again.
  useEffect(() => {
    if (isEmptyPlan(plan)) return;
    const t = setTimeout(() => {
      setPlan((cur) => (cur === plan ? NO_TRANSITIONS : cur));
    }, ROW_ARRIVE_MS + 50);
    return () => clearTimeout(t);
  }, [plan]);

  const shown = useMemo(() => withGhosts(drawn, plan), [drawn, plan]);

  const ghostIds = useMemo(
    () => new Set(plan.ghostRows.map((g) => rowId(g.sectionKey, g.task.id))),
    [plan]
  );
  const ghostSectionKeys = useMemo(
    () => new Set(plan.ghostSections.map((g) => g.section.key)),
    [plan]
  );

  const isArriving = useCallback(
    (sectionKey: string, taskId: string) =>
      plan.arriving.has(rowId(sectionKey, taskId)),
    [plan]
  );
  const isDeparting = useCallback(
    (sectionKey: string, taskId: string) =>
      ghostIds.has(rowId(sectionKey, taskId)),
    [ghostIds]
  );
  const isDepartingSection = useCallback(
    (sectionKey: string) => ghostSectionKeys.has(sectionKey),
    [ghostSectionKeys]
  );

  const liveIds = useCallback(
    (sectionKey: string, ids: string[]) =>
      ghostIds.size === 0
        ? ids
        : ids.filter((id) => !ghostIds.has(rowId(sectionKey, id))),
    [ghostIds]
  );
  const liveData = useCallback(
    (section: DraggableSection) =>
      ghostIds.size === 0
        ? section.data
        : section.data.filter((t) => !ghostIds.has(rowId(section.key, t.id))),
    [ghostIds]
  );

  return {
    sections: shown,
    liveIds,
    liveData,
    isArriving,
    isDeparting,
    isDepartingSection,
    noteDragged,
  };
}
