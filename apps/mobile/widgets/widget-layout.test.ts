/**
 * What a widget says, and which rows its list holds.
 *
 * Both are invisible failures on a device. A subline that repeats its own group
 * header just looks like the app being wordy; a list that leaves tasks off
 * without saying so is a wrong answer about the user's own task list, and
 * nothing on the home screen contradicts it. Neither shows up in a screenshot,
 * so they are pinned here.
 */
import { describe, it, expect } from 'vitest';
import type { Project, Task } from '@do-done/shared';
import { todayLocalISO, addDaysLocalISO } from '@do-done/shared';
import {
  buildNextUp,
  buildTaskRow,
  buildTodayGroups,
  buildUpcomingGroups,
  contentBudget,
  layoutRows,
  listHeight,
  CARD_PADDING_HEIGHT,
  COMPACT_BUDGET_DP,
  HEADER_BAR_HEIGHT,
  ROW_HEIGHT_WITH_SUBLINE,
  WIDGET_MAX_LIST_ROWS,
  type WidgetGroup,
} from './widget-layout';

let seq = 0;

function task(overrides: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `task-${seq}`,
    user_id: 'user-1',
    title: `Task ${seq}`,
    description: null,
    status: 'not_started',
    priority: 'p3',
    project_id: null,
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
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Task;
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    user_id: 'user-1',
    name: 'Home',
    color: '#22c55e',
    icon: '🏠',
    parent_project_id: null,
    sort_order: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Project;
}

const DAY_GROUP: WidgetGroup = {
  key: 'today',
  title: 'Today',
  tasks: [],
  namesTheDay: true,
};
const OVERDUE_GROUP: WidgetGroup = {
  key: 'overdue',
  title: 'Overdue',
  tasks: [],
  namesTheDay: false,
};

describe('what a row says', () => {
  it("drops the day its group header just named, and keeps the time", () => {
    const row = buildTaskRow(
      task({ scheduled_date: addDaysLocalISO(1), scheduled_time: '08:15' }),
      { ...DAY_GROUP, title: 'Tomorrow' },
      []
    );
    // Not "Tomorrow 8:15 AM" — the header above it already said Tomorrow.
    expect(row.subline).toBe('8:15 AM');
  });

  it('says nothing at all for a bare task under a day header', () => {
    const row = buildTaskRow(
      task({ scheduled_date: addDaysLocalISO(1) }),
      { ...DAY_GROUP, title: 'Tomorrow' },
      []
    );
    // No placeholder, no empty chip — the row is one line tall.
    expect(row.subline).toBe('');
  });

  it('keeps the age under Overdue, which is not a day', () => {
    const row = buildTaskRow(
      task({ scheduled_date: addDaysLocalISO(-3) }),
      OVERDUE_GROUP,
      []
    );
    expect(row.subline).toContain('ago');
    expect(row.gutter).toBe('overdue');
  });

  it('keeps the project name, because the ring is a cue and not a label', () => {
    const p = project({ name: 'Errands', color: '#f59e0b', icon: null });
    const row = buildTaskRow(
      task({ project_id: p.id, scheduled_date: addDaysLocalISO(1) }),
      { ...DAY_GROUP, title: 'Tomorrow' },
      [p]
    );
    expect(row.subline).toBe('Errands');
    // ...and the row still resolves the project, for the ring's colour.
    expect(row.project?.color).toBe('#f59e0b');
  });

  it('draws no gutter mark for P4, the rank nobody chose', () => {
    expect(buildTaskRow(task({ priority: 'p4' }), DAY_GROUP, []).gutter).toBeNull();
    expect(buildTaskRow(task({ priority: 'p1' }), DAY_GROUP, []).gutter).toBe('p1');
    expect(buildTaskRow(task({ priority: 'p2' }), DAY_GROUP, []).gutter).toBe('p2');
    expect(buildTaskRow(task({ priority: 'p3' }), DAY_GROUP, []).gutter).toBe('p3');
  });

  it('lets a narrow widget drop the estimate column', () => {
    const t = task({ duration_minutes: 45 });
    expect(buildTaskRow(t, DAY_GROUP, []).estimate).toBe('45m');
    expect(buildTaskRow(t, DAY_GROUP, [], { hideEstimate: true }).estimate).toBe('');
  });
});

describe('listing the rows', () => {
  function groupsOf(counts: number[], overrides: Partial<Task> = {}): WidgetGroup[] {
    return counts.map((n, i) => ({
      key: `g${i}`,
      title: `Group ${i}`,
      tasks: Array.from({ length: n }, () => task(overrides)),
      namesTheDay: true,
    }));
  }

  const tasksIn = (rows: ReturnType<typeof layoutRows>['rows']) =>
    rows.filter((r) => r.type === 'task').length;

  it('subtracts the title bar and the card padding from the widget height', () => {
    expect(contentBudget(160)).toBe(160 - HEADER_BAR_HEIGHT - CARD_PADDING_HEIGHT);
    // A widget too small to hold anything gets a floor, not a negative budget.
    expect(contentBudget(10)).toBe(0);
  });

  it('never gives the list less height than its tallest row', () => {
    // The library throws on a 0-tall ListWidget, and the throw blanks the
    // widget. It also requires each item to fit inside the list.
    expect(listHeight(0)).toBe(ROW_HEIGHT_WITH_SUBLINE);
    expect(listHeight(60)).toBe(ROW_HEIGHT_WITH_SUBLINE);
    // At the smallest size app.config.ts allows, the list is the space left.
    expect(listHeight(110)).toBe(contentBudget(110));
  });

  it('omits group headers when there is only one group', () => {
    const { rows } = layoutRows(groupsOf([3]), [], 500);
    expect(rows.every((r) => r.type === 'task')).toBe(true);
  });

  it('lists every task however short the widget is', () => {
    // The regression this guards: the rows did not scroll, so a short widget
    // showed what fit and "+N more", and the rest could only be reached in the
    // app.
    for (const budget of [0, 10, 60, 137, 500]) {
      const { rows, hiddenCount } = layoutRows(groupsOf([4, 3, 2]), [], budget);
      expect(tasksIn(rows)).toBe(9);
      expect(rows.filter((r) => r.type === 'header')).toHaveLength(3);
      expect(hiddenCount).toBe(0);
    }
  });

  it('drops every subline rather than shrink one, on a small cell', () => {
    const dated = { scheduled_time: '09:00', scheduled_date: todayLocalISO() };
    const tight = layoutRows(groupsOf([10], dated), [], COMPACT_BUDGET_DP - 1);
    const roomy = layoutRows(groupsOf([10], dated), [], COMPACT_BUDGET_DP);

    const sublines = (r: ReturnType<typeof layoutRows>) =>
      r.rows.filter((x) => x.type === 'task' && x.subline).length;
    expect(sublines(tight)).toBe(0);
    expect(sublines(roomy)).toBeGreaterThan(0);
    // Density changes what a row says, never which rows there are.
    expect(tight.rows.length).toBe(roomy.rows.length);
  });

  it('stops at the cap and counts the rest', () => {
    const half = WIDGET_MAX_LIST_ROWS / 2 + 5;
    const { rows, hiddenCount } = layoutRows(groupsOf([half, half]), [], 500);
    expect(tasksIn(rows)).toBe(WIDGET_MAX_LIST_ROWS);
    expect(hiddenCount).toBe(half * 2 - WIDGET_MAX_LIST_ROWS);
    // A header counts its whole group, including the tasks the cap left off.
    const second = rows.filter((r) => r.type === 'header')[1];
    expect(second?.type === 'header' && second.count).toBe(half);
  });

  it('does not start a group the cap leaves no room for', () => {
    const { rows, hiddenCount } = layoutRows(
      groupsOf([WIDGET_MAX_LIST_ROWS, 5]),
      [],
      500
    );
    expect(rows[rows.length - 1]?.type).toBe('task');
    expect(rows.filter((r) => r.type === 'header')).toHaveLength(1);
    expect(hiddenCount).toBe(5);
  });

  it('never leaves a group header with nothing under it', () => {
    for (const counts of [[2, 2, 2], [1, 1], [WIDGET_MAX_LIST_ROWS - 1, 3, 3]]) {
      const { rows } = layoutRows(groupsOf(counts), [], 500);
      expect(rows[rows.length - 1]?.type).not.toBe('header');
      rows.forEach((row, i) => {
        if (row.type === 'header') expect(rows[i + 1]?.type).toBe('task');
      });
    }
  });
});

describe('grouping', () => {
  it('puts overdue work first and names the day of the rest', () => {
    const groups = buildTodayGroups([
      task({ scheduled_date: addDaysLocalISO(-2) }),
      task({ scheduled_date: todayLocalISO() }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'today']);
    // Only the day-named group suppresses dates in its rows.
    expect(groups[0].namesTheDay).toBe(false);
    expect(groups[1].namesTheDay).toBe(true);
  });

  it('gives Upcoming a Today section even with nothing in it', () => {
    const groups = buildUpcomingGroups([
      task({ scheduled_date: addDaysLocalISO(1) }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['Today', 'Tomorrow']);
  });

  it('does not treat Later or Anytime as days', () => {
    const groups = buildUpcomingGroups([
      task({ scheduled_date: addDaysLocalISO(30) }),
      task(),
    ]);
    const byTitle = Object.fromEntries(groups.map((g) => [g.title, g.namesTheDay]));
    expect(byTitle['Later']).toBe(false);
    expect(byTitle['Anytime']).toBe(false);
  });
});

describe('the Next up strip', () => {
  it('takes the head of the Today list, so it agrees with the Today widget', () => {
    const tasks = [
      task({ scheduled_date: todayLocalISO(), priority: 'p3' }),
      task({ scheduled_date: addDaysLocalISO(-1), priority: 'p4' }),
    ];
    const head = buildTodayGroups(tasks).flatMap((g) => g.tasks)[0];
    const next = buildNextUp(tasks);
    expect(next.task?.id).toBe(head.id);
    expect(next.remaining).toBe(1);
  });

  it('has nothing to show rather than something wrong when the day is clear', () => {
    expect(buildNextUp([])).toEqual({ task: null, remaining: 0 });
  });
});
