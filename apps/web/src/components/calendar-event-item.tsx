import type { CalendarEvent } from "@do-done/shared";
import { colors } from "@do-done/ui";

// Fallback when a calendar has no color — the app accent token.
export const EVENT_FALLBACK_COLOR = colors.primary[500];

/** Wall-clock minutes-since-midnight from an RFC3339 string, or null. */
export function eventClockMinutes(rfc3339: string | null): number | null {
  if (!rfc3339) return null;
  const hh = Number(rfc3339.slice(11, 13));
  const mm = Number(rfc3339.slice(14, 16));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function clockLabel(minutes: number): string {
  const hh = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const suffix = hh < 12 ? "AM" : "PM";
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/**
 * "9:00 – 10:30 AM"; null for all-day. Derived from the RFC3339 string's own
 * clock portion — the fetch layer requested event times in the user's
 * preferred timezone, and string math (unlike Date + toLocaleTimeString) gives
 * identical output on server and client, so SSR HTML matches hydration.
 */
export function formatEventTime(event: CalendarEvent): string | null {
  if (event.all_day) return null;
  const start = eventClockMinutes(event.start);
  if (start === null) return null;
  const end = eventClockMinutes(event.end);
  return end === null ? clockLabel(start) : `${clockLabel(start)} – ${clockLabel(end)}`;
}

/**
 * A read-only Google Calendar event row for list views (Today, Upcoming).
 * Deliberately quieter than a task row — a hollow colored dot (events) vs the
 * filled checkbox (tasks) — and it links out to Google Calendar since events
 * are edited there, not in DoDone.
 */
export function CalendarEventRow({ event }: { event: CalendarEvent }) {
  const color = event.color ?? EVENT_FALLBACK_COLOR;
  const time = formatEventTime(event);

  const content = (
    <>
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full border-[1.5px] bg-transparent"
        style={{ borderColor: color }}
      />
      <span className="shrink-0 tabular-nums text-neutral-400">
        {time ?? "All day"}
      </span>
      <span className="min-w-0 truncate text-neutral-600 dark:text-neutral-300">
        {event.title}
      </span>
    </>
  );

  const className =
    "flex items-center gap-2 rounded-md px-3 py-1 text-xs leading-5";

  if (event.html_link) {
    return (
      <a
        href={event.html_link}
        target="_blank"
        rel="noreferrer"
        title={event.calendar_name ?? undefined}
        className={`${className} hover:bg-neutral-50 dark:hover:bg-neutral-900`}
      >
        {content}
      </a>
    );
  }
  return (
    <div title={event.calendar_name ?? undefined} className={className}>
      {content}
    </div>
  );
}

/** The per-day event list shown above a day's tasks in Today/Upcoming. */
export function CalendarEventList({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mb-1 border-b border-dashed border-neutral-100 pb-1 dark:border-neutral-800">
      {events.map((e) => (
        <CalendarEventRow key={e.id} event={e} />
      ))}
    </div>
  );
}
