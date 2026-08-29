/**
 * What a widget says, and how much of it fits.
 *
 * Both are invisible failures on a device. A subline that repeats its own group
 * header just looks like the app being wordy; a "+N more" computed off the wrong
 * capacity is a wrong number about the user's own task list, and nothing on the
 * home screen contradicts it. Neither shows up in a screenshot, so they are
 * pinned here.
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
  rowHeight,
  CARD_PADDING_HEIGHT,
  COMPACT_BUDGET_DP,
  FIRST_GROUP_HEADER_HEIGHT,
  GROUP_HEADER_HEIGHT,
  HEADER_BAR_HEIGHT,
  MORE_ROW_HEIGHT,
  ROW_HEIGHT_BARE,
  ROW_HEIGHT_WITH_SUBLINE,
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
    expect(rowHeight(row, false)).toBe(ROW_HEIGHT_BARE);
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

describe('spending the height budget', () => {
  function groupsOf(counts: number[], overrides: Partial<Task> = {}): WidgetGroup[] {
    return counts.map((n, i) => ({
      key: `g${i}`,
      title: `Group ${i}`,
      tasks: Array.from({ length: n }, () => task(overrides)),
      namesTheDay: true,
    }));
  }

  it('subtracts the title bar and the card padding from the widget height', () => {
    expect(contentBudget(160)).toBe(160 - HEADER_BAR_HEIGHT - CARD_PADDING_HEIGHT);
    // A widget too small to hold anything gets a floor, not a negative budget.
    expect(contentBudget(10)).toBe(0);
  });

  it('omits group headers when there is only one group', () => {
    const { rows } = layoutRows(groupsOf([3]), [], 500);
    expect(rows.every((r) => r.type === 'task')).toBe(true);
  });

  it('charges a bare row less than one carrying a subline', () => {
    const dated = { scheduled_time: '09:00', scheduled_date: todayLocalISO() };
    const bare = layoutRows(groupsOf([10]), [], 300);
    const withSub = layoutRows(groupsOf([10], dated), [], 300);
    // What the budget buys: identical inputs but for what the rows have to say,
    // and the sparser list gets more of them on screen.
    expect(bare.rows.length).toBeGreaterThan(withSub.rows.length);
    expect(ROW_HEIGHT_WITH_SUBLINE).toBeGreaterThan(ROW_HEIGHT_BARE);
  });

  it('drops every subline rather than shrink one, on a small cell', () => {
    const dated = { scheduled_time: '09:00', scheduled_date: todayLocalISO() };
    const tight = layoutRows(groupsOf([10], dated), [], COMPACT_BUDGET_DP - 1);
    const roomy = layoutRows(groupsOf([10], dated), [], COMPACT_BUDGET_DP);

    const sublines = (r: ReturnType<typeof layoutRows>) =>
      r.rows.filter((x) => x.type === 'task' && x.subline).length;
    expect(sublines(tight)).toBe(0);
    expect(sublines(roomy)).toBeGreaterThan(0);
    // ...and the point of dropping them: a 3x2 shows tasks instead of one task.
    expect(tight.rows.length).toBeGreaterThan(roomy.rows.length);
  });

  it('gives a 3x2-ish cell more than a single row', () => {
    // The regression this guards: at 34 dp a row plus its reserved "+N more"
    // ate a 160 dp cell after one task, and the widget was a header and a line.
    const { rows } = layoutRows(
      groupsOf([1, 4], { scheduled_time: '09:00', scheduled_date: todayLocalISO() }),
      [],
      contentBudget(160)
    );
    expect(rows.filter((r) => r.type === 'task').length).toBeGreaterThanOrEqual(2);
  });

  it('never overspends the budget, "+N more" included', () => {
    for (const budget of [24, 47, 90, 137, 240, 500]) {
      const { rows, hiddenCount } = layoutRows(groupsOf([4, 3, 2]), [], budget);
      const used = rows.reduce((n, r, i) => n + rowHeight(r, i === 0), 0);
      expect(used + (hiddenCount > 0 ? MORE_ROW_HEIGHT : 0)).toBeLessThanOrEqual(
        budget
      );
    }
  });

  it('offers the way out when the cell is too small for even one row', () => {
    // The one place the budget is deliberately overspent: a widget this small
    // has nothing useful to draw, and "+9 more" at least opens the list.
    const { rows, hiddenCount } = layoutRows(groupsOf([4, 3, 2]), [], 10);
    expect(rows).toHaveLength(0);
    expect(hiddenCount).toBe(9);
  });

  it('counts everything it did not draw', () => {
    const { rows, hiddenCount } = layoutRows(groupsOf([4, 3, 2]), [], 120);
    const shown = rows.filter((r) => r.type === 'task').length;
    expect(shown + hiddenCount).toBe(9);
    expect(hiddenCount).toBeGreaterThan(0);
  });

  it('reserves room for "+N more" rather than filling to the edge', () => {
    // Exactly two bare rows' worth of budget, with three tasks to place. The
    // second row has to give way, or the "+1 more" it implies has nowhere to go.
    const { rows, hiddenCount } = layoutRows(groupsOf([3]), [], ROW_HEIGHT_BARE * 2);
    const used = rows.reduce((n, r, i) => n + rowHeight(r, i === 0), 0);
    expect(hiddenCount).toBeGreaterThan(0);
    expect(used + MORE_ROW_HEIGHT).toBeLessThanOrEqual(ROW_HEIGHT_BARE * 2);
  });

  it('draws every task and reserves nothing when they all fit', () => {
    const { rows, hiddenCount } = layoutRows(groupsOf([2]), [], ROW_HEIGHT_BARE * 2);
    expect(rows).toHaveLength(2);
    expect(hiddenCount).toBe(0);
  });

  it('never leaves a group header with nothing under it', () => {
    for (let budget = 0; budget <= 200; budget += 3) {
      const { rows } = layoutRows(groupsOf([2, 2, 2]), [], budget);
      expect(rows[rows.length - 1]?.type).not.toBe('header');
      rows.forEach((row, i) => {
        if (row.type === 'header') expect(rows[i + 1]?.type).toBe('task');
      });
    }
  });

  it('charges the first header less, because it has no row to clear', () => {
    expect(FIRST_GROUP_HEADER_HEIGHT).toBeLessThan(GROUP_HEADER_HEIGHT);
    const { rows } = layoutRows(groupsOf([1, 1]), [], 500);
    expect(rowHeight(rows[0], true)).toBe(FIRST_GROUP_HEADER_HEIGHT);
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
