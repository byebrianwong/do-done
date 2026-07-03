import { formatEventTime, type CalendarEvent } from "@do-done/shared";
import { colors } from "@do-done/ui";

// Formatting helpers live in @do-done/shared (mobile renders the same rows);
// re-exported here so sibling components keep one import site.
export { eventClockMinutes, formatEventTime } from "@do-done/shared";

// Fallback when a calendar has no color — the app accent token.
export const EVENT_FALLBACK_COLOR = colors.primary[500];

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
