/**
 * What the List widget puts in its body, for each of the two things it can be
 * pinned to.
 *
 * The failures these pin are the ones a screenshot cannot show. A shopping
 * widget whose rows carry the project's ring paints itself one colour and says
 * nothing — and looks perfectly deliberate. A cart drawn as rows fills the cell
 * with things already bought. A project widget that hides its dates is a list
 * of titles. None of them throws.
 */
import { describe, it, expect } from 'vitest';
import type { Aisle, AisleMemory, Project, Task } from '@do-done/shared';
import {
  AISLE_COLOR,
  NO_AISLE_COLOR,
  addDaysLocalISO,
  todayLocalISO,
} from '@do-done/shared';

import {
  buildListGroups,
  buildProjectGroups,
  listWidgetSubtitle,
} from './widget-list-layout';
import { buildTaskRow, layoutRows, type WidgetTaskRow } from './widget-layout';

let seq = 0;

function item(title: string, overrides: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `item-${seq}`,
    user_id: 'user-1',
    title,
    description: null,
    status: 'not_started',
    priority: 'p4',
    project_id: 'groceries',
    parent_task_id: null,
    scheduled_date: null,
    scheduled_time: null,
    deadline_date: null,
    deadline_time: null,
    duration_minutes: null,
    energy_level: null,
    recurrence_rule: null,
    completed_at: null,
    focus_override: null,
    sort_order: 0,
    tags: [],
    is_list_item: true,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Task;
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'groceries',
    user_id: 'user-1',
    name: 'Groceries',
    color: '#22c55e',
    icon: '🛒',
    parent_project_id: null,
    sort_order: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Project;
}

/** Enough items, in enough aisles, that `groupByAisle` bothers to group. */
function aShop(): Task[] {
  return [
    item('bananas'),
    item('apples'),
    item('milk'),
    item('cheese'),
    item('bread'),
    item('sourdough'),
  ];
}

describe('a shopping list in the widget', () => {
  it('groups by aisle, in walking order', () => {
    const groups = buildListGroups(aShop());
    expect(groups.map((g) => g.key)).toEqual(['produce', 'bakery', 'dairy']);
    expect(groups.every((g) => g.listItems)).toBe(true);
  });

  it('leaves the cart out of the body and reports it in the subtitle instead', () => {
    const items = [...aShop(), item('eggs', { status: 'done' })];
    const drawn = buildListGroups(items).flatMap((g) => g.tasks);

    expect(drawn.some((t) => t.title === 'eggs')).toBe(false);
    // The cart is what tells you there is something to put away, so it is said
    // somewhere — just not as a route through a shop you have already walked.
    expect(listWidgetSubtitle({ isList: true, tasks: items })).toBe(
      '6 items · 1 in the cart'
    );
  });

  it('says "Nothing on it" rather than "0 items"', () => {
    expect(listWidgetSubtitle({ isList: true, tasks: [] })).toBe('Nothing on it');
  });

  it('renders flat when grouping would gain nothing', () => {
    // Three items is under AISLE_GROUP_MIN_ITEMS, so `groupByAisle` collapses —
    // and `layoutRows` draws no header for a single group, which is what makes
    // a short list look like the plain list it always was.
    const groups = buildListGroups([item('milk'), item('bread'), item('jam')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('');
  });

  it('colours each row by its own aisle, not by the project', () => {
    const groups = buildListGroups(aShop());
    const rings = groups.flatMap((g) =>
      g.tasks.map((t) => buildTaskRow(t, g, [project()]).ring)
    );

    // Every item on one list shares a project, so a project ring would paint
    // the whole widget #22c55e.
    expect(rings.every((r) => r.color !== '#22c55e')).toBe(true);
    expect(rings).toContainEqual(
      expect.objectContaining({ color: AISLE_COLOR.produce })
    );
    expect(rings).toContainEqual(
      expect.objectContaining({ color: AISLE_COLOR.dairy })
    );
  });

  it('gives an unrecognised item a chosen neutral and no icon', () => {
    const items = [...aShop(), item('zorbfleem')];
    const groups = buildListGroups(items);
    const other = groups.find((g) => g.key === 'other');
    const row = buildTaskRow(other!.tasks[0], other!, [project()]);

    expect(other?.title).toBe('Other');
    expect(row.ring).toEqual({ color: NO_AISLE_COLOR, icon: null });
  });

  it('takes a taught aisle over the lexicon', () => {
    const memory: AisleMemory = new Map<string, Aisle>([['bananas', 'frozen']]);
    const groups = buildListGroups(aShop(), memory);
    const frozen = groups.find((g) => g.key === 'frozen');

    expect(frozen?.tasks.map((t) => t.title)).toEqual(['bananas']);
    expect(buildTaskRow(frozen!.tasks[0], frozen!, [], { aisleMemory: memory }).ring.color).toBe(
      AISLE_COLOR.frozen
    );
  });

  it("puts the shops and the day in the row's subline, not the project", () => {
    const items = [
      ...aShop(),
      item('batteries', { tags: ['at:Target'], scheduled_date: addDaysLocalISO(1) }),
    ];
    const groups = buildListGroups(items);
    const group = groups.find((g) =>
      g.tasks.some((t) => t.title === 'batteries')
    )!;
    const row = buildTaskRow(
      group.tasks.find((t) => t.title === 'batteries')!,
      group,
      [project()]
    );

    expect(row.subline).toContain('Target');
    // The widget's own title is the list. Naming it on every row would spend
    // the width twice.
    expect(row.subline).not.toContain('Groceries');
    // An estimate on a thing to buy is not a thing anyone sets.
    expect(row.estimate).toBe('');
  });
});

describe('a project in the widget', () => {
  const work = project({ id: 'work', name: 'Work', color: '#6366f1', icon: null });

  function task(title: string, overrides: Partial<Task> = {}): Task {
    return item(title, { project_id: 'work', is_list_item: false, ...overrides });
  }

  it('puts what is late first', () => {
    const groups = buildProjectGroups([
      task('write it up', { scheduled_date: todayLocalISO() }),
      task('chase the invoice', { scheduled_date: addDaysLocalISO(-3) }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'todo']);
    expect(groups[0].tasks.map((t) => t.title)).toEqual(['chase the invoice']);
  });

  it('leaves finished work out', () => {
    const groups = buildProjectGroups([
      task('done one', { status: 'done' }),
      task('cancelled one', { status: 'cancelled' }),
    ]);
    expect(groups).toEqual([]);
  });

  it('keeps the dates, because that is most of why a project is pinned', () => {
    const groups = buildProjectGroups([
      task('ship it', { scheduled_date: addDaysLocalISO(1) }),
    ]);
    const row = buildTaskRow(groups[0].tasks[0], groups[0], [work]);

    expect(groups.every((g) => g.namesTheDay === false)).toBe(true);
    expect(row.subline).not.toBe('');
    // The widget's title already says Work.
    expect(row.subline).not.toContain('Work');
  });

  it('carries the project in the ring, as every task row does', () => {
    const groups = buildProjectGroups([task('ship it')]);
    expect(buildTaskRow(groups[0].tasks[0], groups[0], [work]).ring).toEqual({
      color: '#6366f1',
      icon: null,
    });
  });

  it('counts what is left the way the Today widget does', () => {
    expect(
      listWidgetSubtitle({
        isList: false,
        tasks: [task('a'), task('b'), task('c', { status: 'done' })],
      })
    ).toBe('2 left');
  });
});

describe('both bodies go through the one fitter', () => {
  it('spends the same height budget and reports the same overflow', () => {
    const groups = buildListGroups(aShop());
    // Room for a couple of rows and nothing else.
    const { rows, hiddenCount } = layoutRows(groups, [project()], 70);
    const drawn = rows.filter((r): r is WidgetTaskRow => r.type === 'task');

    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length + hiddenCount).toBe(6);
  });
});
