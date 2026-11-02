import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ getTasksApi: vi.fn(), getProjectsApi: vi.fn() }));
vi.mock('./widgets', () => ({ refreshTaskWidgets: vi.fn() }));
vi.mock('./location-queries', () => ({ scheduleGeofenceSync: vi.fn() }));
vi.mock('./task-reminders', () => ({ scheduleTaskReminderSync: vi.fn() }));
vi.mock('./wear', () => ({ scheduleWatchSync: vi.fn() }));
vi.mock('./query-client', () => ({ queryClient: {} }));

import { todayTaskQuery } from './task-queries';

describe('todayTaskQuery', () => {
  it('reads dated tasks through tomorrow, a day of slack past today', () => {
    expect(todayTaskQuery(new Date(2026, 9, 29, 23, 50))).toEqual({
      datedThrough: '2026-10-30',
    });
  });
});
