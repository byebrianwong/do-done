import { describe, expect, it, vi } from 'vitest';

// The loader reaches for Supabase; the window it asks for does not.
vi.mock('@/lib/supabase', () => ({
  supabase: {},
  getTasksApi: vi.fn(),
  getProjectsApi: vi.fn(),
}));

import { widgetTaskQuery } from './widget-data';
import { UPCOMING_HORIZON_DAYS } from './widget-layout';

describe('widgetTaskQuery', () => {
  const now = new Date(2026, 9, 29, 14, 30);

  it('reads dated tasks through the Upcoming horizon plus one day', () => {
    // Today is Oct 29. The Upcoming widget lists 7 days ahead, and the watch
    // also builds tomorrow's view, so the dated read has to reach Nov 6.
    expect(UPCOMING_HORIZON_DAYS).toBe(7);
    expect(widgetTaskQuery(now).datedThrough).toBe('2026-11-06');
  });

  it('asks for tasks finished since local midnight', () => {
    const since = new Date(widgetTaskQuery(now).completedSince);
    expect(since.getTime()).toBe(new Date(2026, 9, 29).getTime());
  });
});
