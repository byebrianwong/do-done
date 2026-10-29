import { describe, expect, it } from 'vitest';
import type { Task } from '@do-done/shared';

import {
  NO_TRANSITIONS,
  carryGhosts,
  planTransitions,
  rowId,
  withGhosts,
} from './section-transitions';
import type { DraggableSection } from './section-rows';

const t = (id: string) => ({ id }) as Task;
const sec = (key: string, ...ids: string[]): DraggableSection => ({
  key,
  title: key,
  data: ids.map(t),
});
const none = new Set<string>();
const shape = (sections: DraggableSection[]) =>
  sections.map((s) => `${s.key}:${s.data.map((x) => x.id).join(',')}`);

describe('planTransitions: collapse and expand', () => {
  it('keeps the rows of a section that just closed, so they can fold', () => {
    const plan = planTransitions(
      [sec('a', '1', '2'), sec('b', '3')],
      [sec('a'), sec('b', '3')],
      { collapsedBefore: none, collapsedAfter: new Set(['a']) }
    );
    expect(plan.ghostRows.map((g) => [g.sectionKey, g.task.id, g.index])).toEqual([
      ['a', '1', 0],
      ['a', '2', 1],
    ]);
    expect(plan.arriving.size).toBe(0);
  });

  it('opens the rows of a section that just expanded', () => {
    const plan = planTransitions(
      [sec('a'), sec('b', '3')],
      [sec('a', '1', '2'), sec('b', '3')],
      { collapsedBefore: new Set(['a']), collapsedAfter: none }
    );
    expect([...plan.arriving]).toEqual([rowId('a', '1'), rowId('a', '2')]);
    expect(plan.ghostRows).toEqual([]);
  });

  it('does nothing when nothing was toggled, so a refetch never animates', () => {
    const plan = planTransitions(
      [sec('a', '1'), sec('b', '3')],
      [sec('a', '1', '4'), sec('b')],
      { collapsedBefore: none, collapsedAfter: none }
    );
    expect(plan).toEqual({ ghostRows: [], ghostSections: [], arriving: new Set() });
  });

  it('ignores a collapsed key for a section that was not drawn before', () => {
    const plan = planTransitions([], [sec('a')], {
      collapsedBefore: none,
      collapsedAfter: new Set(['a']),
    });
    expect(plan.ghostRows).toEqual([]);
  });
});

describe('planTransitions: moves', () => {
  const before = [sec('focus', 'a', 'b'), sec('other', 'c', 'd')];
  const after = [sec('focus', 'b', 'c'), sec('other', 'd')];

  it('folds the task out of the section it left and opens it in the new one', () => {
    const plan = planTransitions(before, after, {
      collapsedBefore: none,
      collapsedAfter: none,
      trackMoves: true,
    });
    expect(plan.ghostRows.map((g) => [g.sectionKey, g.task.id, g.index])).toEqual([
      ['other', 'c', 0],
    ]);
    expect([...plan.arriving]).toEqual([rowId('focus', 'c')]);
  });

  it('is off unless the list asks for it', () => {
    const plan = planTransitions(before, after, {
      collapsedBefore: none,
      collapsedAfter: none,
    });
    expect(plan.ghostRows).toEqual([]);
    expect(plan.arriving.size).toBe(0);
  });

  it('leaves a dragged task alone: the drop already put it there', () => {
    const plan = planTransitions(before, after, {
      collapsedBefore: none,
      collapsedAfter: none,
      trackMoves: true,
      dragged: new Set(['c']),
    });
    expect(plan.ghostRows).toEqual([]);
    expect(plan.arriving.size).toBe(0);
  });

  it('does not count a task that left by completing as a move', () => {
    const plan = planTransitions(before, [sec('focus', 'b'), sec('other', 'c', 'd')], {
      collapsedBefore: none,
      collapsedAfter: none,
      trackMoves: true,
    });
    expect(plan.ghostRows).toEqual([]);
  });
});

describe('planTransitions: removed sections', () => {
  it('folds away the header of a section that left the list', () => {
    const plan = planTransitions(
      [sec('a', '1'), sec('b', '2'), sec('c', '3')],
      [sec('a', '1'), sec('c', '3')],
      { collapsedBefore: none, collapsedAfter: none, foldRemovedSections: true }
    );
    expect(plan.ghostSections.map((g) => [g.section.key, g.index, g.section.data])).toEqual([
      ['b', 1, []],
    ]);
  });

  it('does nothing for a regroup, which adds sections as well as removing them', () => {
    const plan = planTransitions(
      [sec('a', '1'), sec('b', '2')],
      [sec('x', '1', '2')],
      { collapsedBefore: none, collapsedAfter: none, foldRemovedSections: true }
    );
    expect(plan.ghostSections).toEqual([]);
  });

  it('is off unless the list asks for it', () => {
    const plan = planTransitions([sec('a'), sec('b')], [sec('a')], {
      collapsedBefore: none,
      collapsedAfter: none,
    });
    expect(plan.ghostSections).toEqual([]);
  });
});

describe('withGhosts', () => {
  it('puts ghost rows back where they stood', () => {
    const plan = planTransitions(before(), afterMove(), {
      collapsedBefore: none,
      collapsedAfter: none,
      trackMoves: true,
    });
    expect(shape(withGhosts(afterMove(), plan))).toEqual(['focus:b,c', 'other:c,d']);
  });

  it('puts several ghost headers back in their order', () => {
    const plan = planTransitions(
      [sec('a'), sec('b'), sec('c'), sec('d')],
      [sec('a'), sec('d')],
      { collapsedBefore: none, collapsedAfter: none, foldRemovedSections: true }
    );
    expect(shape(withGhosts([sec('a'), sec('d')], plan))).toEqual([
      'a:',
      'b:',
      'c:',
      'd:',
    ]);
  });

  it('returns the same array when there is nothing to add', () => {
    const after = [sec('a', '1')];
    expect(withGhosts(after, NO_TRANSITIONS)).toBe(after);
  });

  function before() {
    return [sec('focus', 'a', 'b'), sec('other', 'c', 'd')];
  }
  function afterMove() {
    return [sec('focus', 'b', 'c'), sec('other', 'd')];
  }
});

describe('carryGhosts', () => {
  it('keeps a ghost that is still folding across an unrelated change', () => {
    const earlier = planTransitions([sec('a', '1')], [sec('a')], {
      collapsedBefore: none,
      collapsedAfter: new Set(['a']),
    });
    const carried = carryGhosts(earlier, NO_TRANSITIONS, [sec('a')]);
    expect(carried.ghostRows.map((g) => g.task.id)).toEqual(['1']);
  });

  it('drops a ghost once the real row is back, so it is never drawn twice', () => {
    const earlier = planTransitions([sec('a', '1')], [sec('a')], {
      collapsedBefore: none,
      collapsedAfter: new Set(['a']),
    });
    const carried = carryGhosts(earlier, NO_TRANSITIONS, [sec('a', '1')]);
    expect(carried.ghostRows).toEqual([]);
  });

  it('drops a ghost header once its section is back', () => {
    const earlier = planTransitions([sec('a'), sec('b')], [sec('a')], {
      collapsedBefore: none,
      collapsedAfter: none,
      foldRemovedSections: true,
    });
    expect(carryGhosts(earlier, NO_TRANSITIONS, [sec('a')]).ghostSections).toHaveLength(1);
    expect(carryGhosts(earlier, NO_TRANSITIONS, [sec('a'), sec('b')]).ghostSections).toEqual([]);
  });
});
