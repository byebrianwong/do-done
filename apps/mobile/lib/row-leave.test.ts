import { describe, it, expect } from 'vitest';
import { DEFAULT_DISPLAY, type DisplayConfig, type Task } from '@do-done/shared';
import {
  displayGroupOf,
  inTodayUniverse,
  leavesBySection,
  patchedTask,
} from './row-leave';

const TODAY = '2026-10-29';

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    status: 'not_started',
    priority: 'p4',
    sort_order: 1000,
    scheduled_date: TODAY,
    scheduled_time: null,
    deadline_date: null,
    deadline_time: null,
    completed_at: null,
    parent_task_id: null,
    project_id: null,
    focus_override: null,
    estimated_minutes: null,
    is_list_item: false,
    tags: [],
    ...over,
  } as unknown as Task;
}

describe('leavesBySection', () => {
  const byDate = leavesBySection((t) => t.scheduled_date ?? 'anytime');

  it('says yes when the section changes', () => {
    const t = task('a');
    expect(byDate(t, patchedTask(t, { scheduled_date: '2026-10-30' }))).toBe(true);
  });

  it('says no when it does not', () => {
    const t = task('a');
    expect(byDate(t, patchedTask(t, { scheduled_date: TODAY }))).toBe(false);
  });

  it('says yes when the row stops being shown', () => {
    const shown = leavesBySection((t) => (t.scheduled_date === TODAY ? 'x' : null));
    const t = task('a');
    expect(shown(t, patchedTask(t, { scheduled_date: '2026-10-30' }))).toBe(true);
  });

  it('says no for a row that was not shown to begin with', () => {
    const none = leavesBySection(() => null);
    expect(none(task('a'), task('a'))).toBe(false);
  });
});

describe('inTodayUniverse', () => {
  it('drops a task moved to tomorrow', () => {
    const all = [task('a'), task('b')];
    const moved = patchedTask(all[0]!, { scheduled_date: '2026-10-30' });
    expect(inTodayUniverse(all, all[0]!, TODAY)).toBe(true);
    // Focus can still pick a task from another day, so pin it out to make the
    // date the only thing deciding.
    expect(
      inTodayUniverse(all, { ...moved, focus_override: 'exclude' } as Task, TODAY)
    ).toBe(false);
  });

  it('keeps a task pinned into Focus whatever its date', () => {
    const all = [task('a', { focus_override: 'include' })];
    const moved = patchedTask(all[0]!, { scheduled_date: '2026-11-05' });
    expect(inTodayUniverse(all, moved, TODAY)).toBe(true);
  });
});

describe('displayGroupOf', () => {
  const byStatus: DisplayConfig = { ...DEFAULT_DISPLAY, group: 'status' };

  it('names the group a task falls in', () => {
    expect(displayGroupOf(task('a'), byStatus, { today: TODAY })).toBe(
      'status:not_started'
    );
  });

  it('is null for a task the filters hide', () => {
    expect(
      displayGroupOf(task('a', { status: 'done' }), byStatus, { today: TODAY })
    ).toBeNull();
  });

  it('keeps a rescheduled task in place on a status-grouped list', () => {
    const leaves = leavesBySection((t) =>
      displayGroupOf(t, byStatus, { today: TODAY })
    );
    const t = task('a');
    expect(leaves(t, patchedTask(t, { scheduled_date: '2026-10-30' }))).toBe(false);
  });
});
