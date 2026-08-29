import {
  parseClockTime,
  shiftISO,
  weekdayOfISO,
  zonedClockToUtc,
  type NotificationSettings,
} from '@do-done/shared';

/**
 * When the digests fire, and what window each one covers.
 *
 * Pure, and separated from the scheduling in `digests.ts` for the reason the
 * rest of `lib/` is: `apps/mobile` has no renderer in CI, so the only things it
 * can test are decisions like these — and this is all date arithmetic across
 * timezones, which is exactly the kind of thing that is wrong by one day for
 * half the world and impossible to notice by looking at a phone.
 *
 * ## Why a plan at all
 *
 * A local notification's text is fixed the moment it is scheduled. There is no
 * push server here — no FCM/APNs credentials, no token table, no cron — so the
 * only thing that can say "you have 4 tasks today" at 8am tomorrow is this
 * device, deciding now. That means:
 *
 * - **Several occurrences are armed at once**, out to `HORIZON_DAYS`, so a user
 *   who doesn't open the app for a few days still gets their digest.
 * - **The whole plan is re-armed and re-costed on every launch and every return
 *   to the foreground**, because by then the task list has moved and the text
 *   scheduled yesterday is a claim about a day that no longer looks like that.
 *   Cheap: one query for the window, then N `scheduleNotificationAsync` calls.
 * - **A window in the plan is what gets counted**, not "today" — the digest for
 *   Thursday is built from Thursday's tasks, computed on Tuesday.
 *
 * A repeating DAILY trigger would need none of this and is the obvious thing to
 * reach for. It is also useless: it would deliver the same frozen sentence every
 * morning until the app was next opened — which is precisely how it would fail
 * the user it is meant to serve.
 */

/** How far ahead to arm. A week covers a normal gap between app opens. */
export const HORIZON_DAYS = 8;

/**
 * Don't arm anything closer than this. The re-arm cancels and re-creates every
 * occurrence, so an app opened at 07:59:30 could otherwise cancel the 08:00
 * digest and schedule its replacement for an instant that has already passed by
 * the time the write lands — which expo-notifications delivers immediately, as
 * a digest arriving the moment you open the app to look at the list it
 * describes.
 */
export const MIN_LEAD_MS = 120_000;

export interface DigestOccurrence {
  kind: 'daily' | 'weekly';
  /** The instant to fire at. */
  at: Date;
  /** First day of the window this digest describes, `YYYY-MM-DD`. */
  startISO: string;
  /** Last day of the window, inclusive. Same as `startISO` for a daily. */
  endISO: string;
}

/**
 * Today's calendar date in `timeZone`, as `YYYY-MM-DD`.
 *
 * Everything below is anchored to this rather than to the device clock's own
 * day. A digest is a wall-clock event in the user's life — see CLAUDE.md →
 * Dates — and the device may well be in a different zone from the one the
 * account is set to.
 */
function todayInZone(now: Date, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA formats as YYYY-MM-DD.
    return fmt.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The instant at which the clock in `timeZone` reads `dateISO` `HH:MM`. */
function instantFor(dateISO: string, time: string, timeZone: string): Date | null {
  const clock = parseClockTime(time);
  if (!clock) return null;
  const [y, m, d] = dateISO.split('-').map(Number);
  return zonedClockToUtc(y, m, d, clock.hour, clock.minute, timeZone);
}

/**
 * Every digest to arm, soonest first.
 *
 * Occurrences already past — or too close to schedule safely — are left out
 * rather than fired late. A digest for a morning that has been and gone is
 * worse than no digest: it describes a day the user has already spent.
 */
export function planDigests(
  settings: NotificationSettings,
  opts: { now: Date; timeZone: string; horizonDays?: number }
): DigestOccurrence[] {
  const { now, timeZone } = opts;
  const horizon = opts.horizonDays ?? HORIZON_DAYS;
  const today = todayInZone(now, timeZone);
  const floor = now.getTime() + MIN_LEAD_MS;
  const out: DigestOccurrence[] = [];

  for (let i = 0; i < horizon; i += 1) {
    const dateISO = shiftISO(today, i);

    if (settings.notify_daily_digest) {
      const at = instantFor(dateISO, settings.notify_daily_digest_time, timeZone);
      if (at && at.getTime() >= floor) {
        out.push({ kind: 'daily', at, startISO: dateISO, endISO: dateISO });
      }
    }

    if (
      settings.notify_weekly_digest &&
      weekdayOfISO(dateISO) === settings.notify_weekly_digest_weekday
    ) {
      const at = instantFor(
        dateISO,
        settings.notify_weekly_digest_time,
        timeZone
      );
      if (at && at.getTime() >= floor) {
        out.push({
          kind: 'weekly',
          at,
          startISO: dateISO,
          // The seven days *from* the digest, not a calendar week. Someone who
          // asks for their week on Monday morning means the week they are about
          // to have; anchoring to Sunday would spend the first line of it on
          // days already gone.
          endISO: shiftISO(dateISO, 6),
        });
      }
    }
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * The inclusive date range a set of occurrences needs task data for, or null
 * when there is nothing to arm. One query covers the whole plan.
 */
export function planQueryRange(
  plan: DigestOccurrence[]
): { startISO: string; endISO: string } | null {
  if (plan.length === 0) return null;
  let startISO = plan[0].startISO;
  let endISO = plan[0].endISO;
  for (const p of plan) {
    if (p.startISO < startISO) startISO = p.startISO;
    if (p.endISO > endISO) endISO = p.endISO;
  }
  return { startISO, endISO };
}
