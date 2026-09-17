import { describe, expect, it } from 'vitest';
import type { Project, Task } from '@do-done/shared';
import { todayLocalISO, addDaysLocalISO } from '@do-done/shared';
import {
  buildWearSnapshot,
  clampTitle,
  WEAR_MAX_ROWS_PER_LIST,
  WEAR_MAX_TITLE_CHARS,
  WEAR_SNAPSHOT_VERSION,
  type WearList,
  type WearRow,
} from './wear-snapshot';

/**
 * Anchored on the real clock, not a pinned date.
 *
 * `buildWearSnapshot` has no `now` to inject — the grouping functions under it
 * read the clock themselves — so a fixture dated to a fixed day would group by
 * the real today and format by the fake one. That disagreement is invisible
 * until the calendar rolls past the pinned date, which is exactly how it was
 * found.
 */
const TODAY = todayLocalISO();
const LONG_AGO = addDaysLocalISO(-10);

function task(over: Partial<Task> & { id: string }): Task {
  return {
    user_id: 'u1',
    title: over.title ?? 'A task',
    description: null,
    status: 'not_started',
    priority: 'p4',
    project_id: null,
    parent_id: null,
    scheduled_date: null,
    scheduled_time: null,
    deadline_date: null,
    deadline_time: null,
    duration_minutes: null,
    recurrence_rule: null,
    tags: [],
    sort_order: 0,
    completed_at: null,
    deleted_at: null,
    is_focused: false,
    is_list_item: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as Task;
}

function project(over: Partial<Project> & { id: string }): Project {
  return {
    user_id: 'u1',
    name: over.name ?? 'Work',
    color: over.color ?? '#22c55e',
    icon: over.icon ?? null,
    kind: 'tasks',
    sort_order: 0,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as Project;
}

function listNamed(lists: WearList[], key: string): WearList {
  const found = lists.find((l) => l.key === key);
  if (!found) throw new Error(`no ${key} list`);
  return found;
}

function rowsOf(list: WearList): WearRow[] {
  return list.groups.flatMap((g) => g.rows);
}

describe('buildWearSnapshot', () => {
  it('stamps the version the watch checks and the time it was built', () => {
    const before = Date.now();
    const snap = buildWearSnapshot({ tasks: [], projects: [] });
    expect(snap.v).toBe(WEAR_SNAPSHOT_VERSION);
    // The watch prints this as "Updated Nm ago", so it has to be the real
    // build time — a zero here would read as a snapshot from 1970.
    expect(snap.generatedAt).toBeGreaterThanOrEqual(before);
    expect(snap.generatedAt).toBeLessThanOrEqual(Date.now());
  });

  it('always offers the three lists, even with nothing in them', () => {
    const snap = buildWearSnapshot({ tasks: [], projects: [] });
    expect(snap.lists.map((l) => l.key)).toEqual([
      'today',
      'upcoming',
      'inbox',
    ]);
  });

  // The whole point of the design: one implementation of what a row says.
  it('carries the subline the in-app row would have shown', () => {
    const snap = buildWearSnapshot({
      tasks: [
        task({
          id: 't1',
          title: 'Call the bank',
          scheduled_date: TODAY,
          project_id: 'p1',
        }),
      ],
      projects: [project({ id: 'p1', name: 'Admin' })],
    });
    const row = rowsOf(listNamed(snap.lists, 'today'))[0];
    // The Today group names the day, so the row must not repeat it — it is left
    // with the project alone.
    expect(row.subline).toBe('Admin');
  });

  it('keeps the day when the group does not name it', () => {
    const snap = buildWearSnapshot({
      tasks: [
        task({ id: 't1', title: 'Late thing', scheduled_date: LONG_AGO }),
      ],
      projects: [],
    });
    const overdue = listNamed(snap.lists, 'today').groups[0];
    expect(overdue.title).toBe('Overdue');
    // "Overdue" is not a day, so the row still says how late it is.
    expect(overdue.rows[0].subline).toMatch(/ago/);
  });

  it('encodes the gutter rather than the priority', () => {
    const snap = buildWearSnapshot({
      tasks: [
        task({ id: 'a', priority: 'p1', scheduled_date: TODAY }),
        task({ id: 'b', priority: 'p4', scheduled_date: TODAY }),
        task({ id: 'c', priority: 'p2', scheduled_date: LONG_AGO }),
      ],
      projects: [],
    });
    const byId = new Map(
      rowsOf(listNamed(snap.lists, 'today')).map((r) => [r.id, r])
    );
    expect(byId.get('a')?.gutter).toBe('p1');
    // P4 draws nothing, for the reason `rowGutter` gives.
    expect(byId.get('b')?.gutter).toBe('');
    // Overdue outranks priority.
    expect(byId.get('c')?.gutter).toBe('overdue');
  });

  it('gives a project-less task the deliberate neutral ring', () => {
    const snap = buildWearSnapshot({
      tasks: [task({ id: 't1', scheduled_date: TODAY })],
      projects: [],
    });
    expect(rowsOf(listNamed(snap.lists, 'today'))[0].ring).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('uses the light ring table, so two projects stay apart on a black face', () => {
    const snap = buildWearSnapshot({
      tasks: [task({ id: 't1', scheduled_date: TODAY, project_id: 'p1' })],
      projects: [project({ id: 'p1', color: '#22c55e' })],
    });
    expect(rowsOf(listNamed(snap.lists, 'today'))[0].ring.toLowerCase()).toBe(
      '#22c55e'
    );
  });

  it('passes an emoji icon through and drops a Phosphor one', () => {
    const snap = buildWearSnapshot({
      tasks: [
        task({ id: 'a', scheduled_date: TODAY, project_id: 'emoji' }),
        task({ id: 'b', scheduled_date: TODAY, project_id: 'phos' }),
      ],
      projects: [
        project({ id: 'emoji', icon: '🚀' }),
        project({ id: 'phos', icon: 'ph:briefcase:fill' }),
      ],
    });
    const byId = new Map(
      rowsOf(listNamed(snap.lists, 'today')).map((r) => [r.id, r])
    );
    expect(byId.get('a')?.icon).toBe('🚀');
    // Not the literal token — a bare coloured ring is the documented fallback.
    expect(byId.get('b')?.icon).toBe('');
  });

  it('files untriaged tasks under Inbox with no day header', () => {
    const snap = buildWearSnapshot({
      tasks: [task({ id: 't1', status: 'inbox' })],
      projects: [],
    });
    const inbox = listNamed(snap.lists, 'inbox');
    expect(inbox.groups).toHaveLength(1);
    expect(inbox.groups[0].title).toBe('');
    expect(inbox.groups[0].rows[0].id).toBe('t1');
  });

  it('keeps shopping-list items off the watch entirely', () => {
    const snap = buildWearSnapshot({
      tasks: [
        task({ id: 'item', status: 'inbox', is_list_item: true }),
        task({
          id: 'boughtItem',
          status: 'done',
          is_list_item: true,
          completed_at: new Date().toISOString(),
        }),
      ],
      projects: [],
    });
    expect(rowsOf(listNamed(snap.lists, 'inbox'))).toHaveLength(0);
    expect(snap.counts.doneToday).toBe(0);
  });

  // A DataItem over 100 KB fails the put outright, so the cap is not cosmetic.
  it('caps a list at the row budget', () => {
    const tasks = Array.from({ length: WEAR_MAX_ROWS_PER_LIST + 25 }, (_, i) =>
      task({ id: `t${i}`, scheduled_date: TODAY })
    );
    const snap = buildWearSnapshot({ tasks, projects: [] });
    expect(rowsOf(listNamed(snap.lists, 'today'))).toHaveLength(
      WEAR_MAX_ROWS_PER_LIST
    );
  });

  it('spends the budget across groups, not per group', () => {
    const tasks = [
      ...Array.from({ length: 30 }, (_, i) =>
        task({ id: `late${i}`, scheduled_date: LONG_AGO })
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        task({ id: `now${i}`, scheduled_date: TODAY })
      ),
    ];
    const snap = buildWearSnapshot({ tasks, projects: [] });
    expect(rowsOf(listNamed(snap.lists, 'today'))).toHaveLength(
      WEAR_MAX_ROWS_PER_LIST
    );
  });

  it('stays well inside the Data Layer payload limit when full', () => {
    const projects = Array.from({ length: 12 }, (_, i) =>
      project({ id: `p${i}`, name: `Project number ${i}`, icon: '📦' })
    );
    const tasks = Array.from({ length: 400 }, (_, i) =>
      task({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        title: 'A fairly long task title that someone actually typed out ' + i,
        project_id: `p${i % 12}`,
        priority: 'p1',
        scheduled_date: addDaysLocalISO(i % 9),
        duration_minutes: 90,
      })
    );
    const bytes = Buffer.byteLength(
      JSON.stringify(buildWearSnapshot({ tasks, projects })),
      'utf8'
    );
    expect(bytes).toBeLessThan(50_000);
  });
});

describe('counts', () => {
  it('names the same next task the Today list leads with', () => {
    const snap = buildWearSnapshot({
      tasks: [
        task({ id: 'a', title: 'Low', priority: 'p4', scheduled_date: TODAY }),
        task({ id: 'b', title: 'Urgent', priority: 'p1', scheduled_date: TODAY }),
      ],
      projects: [],
    });
    const first = rowsOf(listNamed(snap.lists, 'today'))[0];
    expect(snap.counts.nextTitle).toBe(first.title);
    expect(snap.counts.nextTitle).toBe('Urgent');
  });

  it('counts overdue inside openToday rather than beside it', () => {
    const snap = buildWearSnapshot({
      tasks: [
        task({ id: 'a', scheduled_date: TODAY }),
        task({ id: 'b', scheduled_date: LONG_AGO }),
      ],
      projects: [],
    });
    expect(snap.counts.openToday).toBe(2);
    expect(snap.counts.overdue).toBe(1);
  });

  it('counts a completion by the local day it happened on', () => {
    // Two days back rather than one, so a DST transition cannot make the
    // "not today" case land on today after all.
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const snap = buildWearSnapshot({
      tasks: [
        task({ id: 'a', status: 'done', completed_at: new Date().toISOString() }),
        task({ id: 'b', status: 'done', completed_at: twoDaysAgo.toISOString() }),
      ],
      projects: [],
    });
    expect(snap.counts.doneToday).toBe(1);
  });

  it('reports an empty next task rather than a placeholder', () => {
    const snap = buildWearSnapshot({ tasks: [], projects: [] });
    expect(snap.counts.nextTitle).toBe('');
    expect(snap.counts.openToday).toBe(0);
  });
});

describe('clampTitle', () => {
  it('leaves a short title alone', () => {
    expect(clampTitle('Buy milk')).toBe('Buy milk');
  });

  it('cuts a long title at a word boundary', () => {
    const long = 'word '.repeat(40).trim();
    const out = clampTitle(long);
    expect(out.length).toBeLessThanOrEqual(WEAR_MAX_TITLE_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });

  it('hard-cuts a single unbroken word', () => {
    const out = clampTitle('x'.repeat(200));
    expect(out).toBe('x'.repeat(WEAR_MAX_TITLE_CHARS) + '…');
  });
});
