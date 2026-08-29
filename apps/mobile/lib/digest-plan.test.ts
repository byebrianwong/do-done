import { describe, expect, it } from 'vitest';
import {
  NotificationSettingsSchema,
  type NotificationSettings,
} from '@do-done/shared';
import { MIN_LEAD_MS, planDigests, planQueryRange } from './digest-plan';

// Built through the schema rather than as a literal, so a field added to
// NotificationSettings later doesn't break this file — the defaults are the
// point here, not the exact shape.
function settings(over: Partial<NotificationSettings> = {}): NotificationSettings {
  return NotificationSettingsSchema.parse(over);
}

// 2026-08-15 is a Saturday. 06:00 UTC is 02:00 in New York (EDT, UTC−4).
const SAT_06Z = new Date('2026-08-15T06:00:00Z');
const NY = 'America/New_York';

describe('planDigests', () => {
  it('plans nothing when both digests are off', () => {
    expect(planDigests(settings(), { now: SAT_06Z, timeZone: NY })).toEqual([]);
  });

  it('arms one daily per day out to the horizon', () => {
    const plan = planDigests(settings({ notify_daily_digest: true }), {
      now: SAT_06Z,
      timeZone: NY,
      horizonDays: 3,
    });
    expect(plan.map((p) => p.startISO)).toEqual([
      '2026-08-15',
      '2026-08-16',
      '2026-08-17',
    ]);
    expect(plan.every((p) => p.kind === 'daily')).toBe(true);
  });

  // The digest is a wall-clock event in the user's life, so 08:00 has to mean
  // 08:00 where they are — not on a device that has crossed a timezone, and
  // not in UTC. 08:00 EDT is 12:00Z.
  it('fires at the wall clock of the account timezone', () => {
    const [first] = planDigests(settings({ notify_daily_digest: true }), {
      now: SAT_06Z,
      timeZone: NY,
      horizonDays: 1,
    });
    expect(first.at.toISOString()).toBe('2026-08-15T12:00:00.000Z');
  });

  it('reads the same clock in a zone ahead of UTC', () => {
    // 03:00Z is 05:00 in Berlin (UTC+2 in August), so 08:00 local is still
    // ahead — the same wall clock resolves to 06:00Z rather than NY's 12:00Z.
    const [first] = planDigests(settings({ notify_daily_digest: true }), {
      now: new Date('2026-08-15T03:00:00Z'),
      timeZone: 'Europe/Berlin',
      horizonDays: 1,
    });
    expect(first.at.toISOString()).toBe('2026-08-15T06:00:00.000Z');
  });

  // A digest for a morning that has been and gone describes a day the user has
  // already spent.
  it('skips an occurrence whose time has passed today', () => {
    const afternoon = new Date('2026-08-15T20:00:00Z'); // 16:00 in New York
    const plan = planDigests(settings({ notify_daily_digest: true }), {
      now: afternoon,
      timeZone: NY,
      horizonDays: 2,
    });
    expect(plan.map((p) => p.startISO)).toEqual(['2026-08-16']);
  });

  // Re-arming cancels and re-creates every occurrence, so an app opened
  // seconds before the digest would otherwise cancel it and schedule the
  // replacement for an instant already past — which is delivered immediately.
  it('leaves a lead time rather than arming an imminent occurrence', () => {
    const justBefore = new Date(
      new Date('2026-08-15T12:00:00Z').getTime() - MIN_LEAD_MS + 1000
    );
    const plan = planDigests(settings({ notify_daily_digest: true }), {
      now: justBefore,
      timeZone: NY,
      horizonDays: 1,
    });
    expect(plan).toEqual([]);
  });

  it('arms the weekly only on the chosen weekday', () => {
    const plan = planDigests(
      settings({ notify_weekly_digest: true, notify_weekly_digest_weekday: 1 }),
      { now: SAT_06Z, timeZone: NY, horizonDays: 8 }
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe('weekly');
    expect(plan[0].startISO).toBe('2026-08-17'); // the coming Monday
  });

  // Someone asking for their week on Monday means the week they are about to
  // have, not the calendar week they are partway through.
  it('covers the seven days from the digest, not a calendar week', () => {
    const [weekly] = planDigests(
      settings({ notify_weekly_digest: true, notify_weekly_digest_weekday: 1 }),
      { now: SAT_06Z, timeZone: NY, horizonDays: 8 }
    );
    expect(weekly.startISO).toBe('2026-08-17');
    expect(weekly.endISO).toBe('2026-08-23');
  });

  it('returns both kinds in time order', () => {
    const plan = planDigests(
      settings({
        notify_daily_digest: true,
        notify_daily_digest_time: '09:00',
        notify_weekly_digest: true,
        notify_weekly_digest_weekday: 1,
        notify_weekly_digest_time: '07:00',
      }),
      { now: SAT_06Z, timeZone: NY, horizonDays: 4 }
    );
    const times = plan.map((p) => p.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // Monday's weekly (07:00) comes before Monday's daily (09:00).
    const monday = plan.filter((p) => p.startISO === '2026-08-17');
    expect(monday.map((p) => p.kind)).toEqual(['weekly', 'daily']);
  });
});

describe('planQueryRange', () => {
  it('is null for an empty plan', () => {
    expect(planQueryRange([])).toBeNull();
  });

  // One query has to cover every window, and the weekly's reaches a week past
  // the last daily.
  it('spans every window in the plan', () => {
    const plan = planDigests(
      settings({ notify_daily_digest: true, notify_weekly_digest: true }),
      { now: SAT_06Z, timeZone: NY, horizonDays: 8 }
    );
    const range = planQueryRange(plan);
    expect(range).toEqual({ startISO: '2026-08-15', endISO: '2026-08-23' });
  });
});
