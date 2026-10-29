/**
 * Open-task counts for the celebration gate, read at the tap rather than
 * passed as a number at render.
 *
 * `sparkReason` needs to know whether a completion empties its section. The
 * lists used to answer with `openInSection={openCount(section.data)}`, a number
 * that changes on every completion in that section. A changed prop defeats
 * `React.memo(TaskItem)`, so one tick re-rendered every row beside it. A getter
 * that keeps its identity and reads the latest count when called gives the
 * same answer without touching the rows. CLAUDE.md already says the counts are
 * read at the tap; this makes the code match.
 *
 * Plain functions plus one small hook, so the decision is testable in node.
 */

import { useCallback, useMemo, useRef } from 'react';
import type { Task } from '@do-done/shared';

import type { DraggableSection } from './section-rows';

/**
 * A count, or a function that returns one when the row is tapped.
 *
 * `null` (or a getter returning `null`) means "this surface cannot tell",
 * which is different from zero: `sparkReason` skips the rule rather than
 * firing it on a guess.
 */
export type CountSource = number | null | undefined | (() => number | null);

/** The count a source stands for right now. */
export function readCount(source: CountSource): number | null {
  if (typeof source === 'function') return source();
  return source ?? null;
}

/** Tasks in this list that still count as work. Feeds the spark gate. */
export function openCount(tasks: Task[]): number {
  let n = 0;
  for (const t of tasks) if (t.status !== 'done' && t.status !== 'cancelled') n++;
  return n;
}

/** Open count per section key. */
export function openCountsByKey(sections: DraggableSection[]): Map<string, number> {
  return new Map(sections.map((s) => [s.key, openCount(s.data)]));
}

/**
 * One getter per section key, each reading the counts from the latest render.
 *
 * A getter is created once per key and then reused, so a row keeps the same
 * prop across every completion. A key with no section answers 0, which is what
 * the old `sectionOf` fallback (an empty section) produced.
 */
export function createCountGetters(
  read: () => Map<string, number>
): (key: string) => () => number {
  const getters = new Map<string, () => number>();
  return (key) => {
    let g = getters.get(key);
    if (!g) {
      g = () => read().get(key) ?? 0;
      getters.set(key, g);
    }
    return g;
  };
}

/** `createCountGetters` over `sections`, stable for the component's lifetime. */
export function useSectionOpenCounts(
  sections: DraggableSection[]
): (key: string) => () => number {
  const counts = useMemo(() => openCountsByKey(sections), [sections]);
  const countsRef = useRef(counts);
  countsRef.current = counts;
  return useMemo(() => createCountGetters(() => countsRef.current), []);
}

/** A stable getter for a single count that changes between renders. */
export function useCountGetter(value: number | null | undefined): () => number | null {
  const ref = useRef(value);
  ref.current = value;
  return useCallback(() => ref.current ?? null, []);
}
