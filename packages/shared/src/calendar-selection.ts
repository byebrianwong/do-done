import { MAX_DISPLAY_CALENDARS } from "./constants.js";

/**
 * The bit of a Google `calendarList` entry that decides whether DoDone reads
 * events from it. Deliberately structural: the server passes raw
 * `calendar_v3.Schema$CalendarListEntry` rows, the settings picker passes its
 * own serialised `CalendarOption`s, and the tests pass literals.
 */
export interface SelectableCalendar {
  id?: string | null;
  /** Ticked visible in Google Calendar's own sidebar. */
  selected?: boolean | null;
  primary?: boolean | null;
}

/**
 * A calendar as the settings pickers see it — the serialised form
 * `/api/calendar/list` returns, shared by the web section and the mobile
 * screen so both render the same rows from the same fetch.
 */
export interface CalendarOption {
  id: string;
  summary: string;
  primary: boolean;
  /** Ticked visible in Google Calendar's own sidebar. */
  selected: boolean;
  /**
   * Writable, so it can be a sync target. Read-only subscriptions (holidays,
   * sports, a shared calendar someone gave you view access to) can still be
   * *displayed* — they just can't receive task events.
   */
  canWrite: boolean;
  /** Google's colour for the calendar, for the swatch in the picker. */
  color: string | null;
}

/**
 * Whether a calendar should be shown inside DoDone.
 *
 * `hiddenIds === null` means the user has never opened the picker, so we defer
 * to Google: show what they've made visible there. Once they've saved a
 * selection the array is authoritative and Google's flag stops mattering —
 * that's the point of the picker, since a calendar can be unticked in Google
 * and still be one you want beside your tasks (or the reverse).
 *
 * Absence from `hiddenIds` means visible, so a calendar created after the last
 * save shows up on its own rather than waiting to be discovered in Settings.
 */
export function isCalendarVisible(
  cal: SelectableCalendar,
  hiddenIds: string[] | null
): boolean {
  if (!cal.id) return false;
  if (hiddenIds === null) return !!(cal.selected || cal.primary);
  return !hiddenIds.includes(cal.id);
}

/**
 * The calendars DoDone will actually read events from, in Google's list order,
 * capped at `cap`.
 *
 * The cap is a cost ceiling — one `events.list` round-trip per calendar per
 * page load. It bites only when the user is over the limit they were shown in
 * Settings, or when they've never opened Settings and Google has more than
 * `cap` calendars ticked. `overflow` carries whatever the cap excluded so the
 * caller can say so out loud instead of dropping it silently.
 */
export function pickDisplayCalendars<T extends SelectableCalendar>(
  calendars: readonly T[],
  hiddenIds: string[] | null,
  cap: number = MAX_DISPLAY_CALENDARS
): { visible: T[]; overflow: T[] } {
  const wanted = calendars.filter((c) => isCalendarVisible(c, hiddenIds));
  return { visible: wanted.slice(0, cap), overflow: wanted.slice(cap) };
}

/**
 * Fold a set of checkbox states back into the stored exclusion set: every
 * calendar the user can see in the picker that isn't ticked.
 *
 * Scoped to `allIds` on purpose — an id the picker never displayed (a calendar
 * unsubscribed since the last save) drops out of the array rather than
 * accumulating forever.
 */
export function toHiddenIds(
  allIds: readonly string[],
  visibleIds: ReadonlySet<string>
): string[] {
  return allIds.filter((id) => !visibleIds.has(id));
}
