import { describe, expect, it } from 'vitest';
import { routeForNotification } from './notification-routing';

describe('routeForNotification', () => {
  // The location reminder's body *is* a task title, so the tap has exactly one
  // sensible destination. It had none before, which meant arriving at the shop,
  // reading "Buy milk" and landing on whatever screen was last open.
  it('opens the task a location reminder names', () => {
    expect(
      routeForNotification({ kind: 'location', taskId: 'abc-123' })
    ).toBe('/task/abc-123');
  });

  it('opens Today for a daily digest and Upcoming for a weekly one', () => {
    expect(routeForNotification({ kind: 'digest', digest: 'daily' })).toBe(
      '/today'
    );
    expect(routeForNotification({ kind: 'digest', digest: 'weekly' })).toBe(
      '/upcoming'
    );
  });

  // Yanking someone off the screen they were on to guess at a destination is
  // worse than doing nothing, so an unrecognised payload routes nowhere.
  it('routes nowhere rather than guessing', () => {
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification(undefined)).toBeNull();
    expect(routeForNotification({})).toBeNull();
    expect(routeForNotification({ kind: 'something-new' })).toBeNull();
  });

  it('ignores a taskId that isn\'t one', () => {
    expect(routeForNotification({ taskId: '' })).toBeNull();
    expect(routeForNotification({ taskId: 42 })).toBeNull();
  });
});
