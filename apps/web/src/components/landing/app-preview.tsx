/**
 * A miniature, non-interactive rendering of the Today view, for the hero.
 *
 * Deliberately *not* the real components: a screenshot of the app would be
 * stale the day after it's taken, and mounting the real Today view here would
 * drag the whole editor, the DnD sensors and a data layer onto a page whose
 * job is to load fast. This is markup and CSS — no state, no client bundle,
 * server-rendered with the rest of the page.
 *
 * The one moving part is the top task ticking itself off on a loop, which is
 * the gesture the product is named after.
 */

const NAV = [
  { label: "Inbox", count: 4 },
  { label: "Today", count: 7, active: true },
  { label: "Upcoming", count: 12 },
  { label: "Calendar" },
];

const PROJECTS = [
  { name: "Work", color: "#6366f1" },
  { name: "Home", color: "#10b981" },
  { name: "Health", color: "#f43f5e" },
];

interface Row {
  title: string;
  project?: { name: string; color: string };
  estimate?: string;
  when?: string;
  whenTone?: "today" | "overdue" | "plain";
  priority: 1 | 2 | 3 | 4;
  tag?: string;
  /** The row that completes itself on a loop. */
  ticking?: boolean;
}

const FOCUS: Row[] = [
  {
    title: "Send the Q3 numbers to Priya",
    project: PROJECTS[0],
    estimate: "30m",
    when: "Overdue",
    whenTone: "overdue",
    priority: 1,
    ticking: true,
  },
  {
    title: "Write the launch announcement",
    project: PROJECTS[0],
    estimate: "1h 30m",
    when: "9:30",
    whenTone: "today",
    priority: 1,
    tag: "#writing",
  },
  {
    title: "Reply to the landlord about the boiler",
    project: PROJECTS[1],
    estimate: "10m",
    when: "Today",
    whenTone: "today",
    priority: 2,
  },
];

const REST: Row[] = [
  {
    title: "Design review with Sam",
    project: PROJECTS[0],
    when: "14:00",
    whenTone: "today",
    priority: 2,
  },
  {
    title: "Run — 5k easy",
    project: PROJECTS[2],
    estimate: "40m",
    when: "18:00",
    whenTone: "today",
    priority: 3,
  },
  {
    title: "Book the dentist",
    project: PROJECTS[2],
    when: "Today",
    whenTone: "today",
    priority: 3,
  },
];

const PRIORITY_COLOR = {
  1: "#ef4444",
  2: "#f59e0b",
  3: "#6366f1",
  4: "#a3a3a3",
} as const;

function PriorityBars({ priority }: { priority: 1 | 2 | 3 | 4 }) {
  const lit = 5 - priority;
  const heights = ["h-1", "h-1.5", "h-2", "h-2.5"];
  return (
    <span className="inline-flex shrink-0 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`block w-[3px] rounded-[1px] ${heights[i]} ${
            i < lit ? "" : "bg-neutral-200 dark:bg-neutral-700"
          }`}
          style={
            i < lit ? { backgroundColor: PRIORITY_COLOR[priority] } : undefined
          }
        />
      ))}
    </span>
  );
}

function WhenChip({ label, tone }: { label: string; tone: Row["whenTone"] }) {
  const cls =
    tone === "overdue"
      ? "bg-red-50 text-red-500 dark:bg-red-950/60 dark:text-red-400"
      : tone === "today"
        ? "bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400"
        : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function TaskRow({ row }: { row: Row }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-[7px]">
      {/* The completion circle. On the ticking row, three synchronised
          keyframe tracks draw the check, fill the ring and strike the title
          out together — see `globals.css`. */}
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
          row.ticking ? "dd-tick-ring" : ""
        }`}
        style={
          {
            borderColor: PRIORITY_COLOR[row.priority],
            "--dd-ring": PRIORITY_COLOR[row.priority],
          } as React.CSSProperties
        }
        aria-hidden
      >
        <svg
          className={`h-2.5 w-2.5 text-white ${row.ticking ? "dd-tick-fill" : ""}`}
          style={row.ticking ? undefined : { transform: "scale(0)" }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>

      <PriorityBars priority={row.priority} />

      <span
        className={`min-w-0 flex-1 truncate text-[13px] text-neutral-800 dark:text-neutral-100 ${
          row.ticking ? "dd-tick-title" : ""
        }`}
      >
        {row.title}
      </span>

      {row.tag ? (
        <span className="hidden shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600 sm:inline dark:bg-indigo-950 dark:text-indigo-400">
          {row.tag}
        </span>
      ) : null}

      {row.project ? (
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-neutral-500 sm:inline-flex dark:text-neutral-400">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: row.project.color }}
          />
          {row.project.name}
        </span>
      ) : null}

      {row.estimate ? (
        <span className="hidden shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 md:inline dark:bg-neutral-800 dark:text-neutral-400">
          ~{row.estimate}
        </span>
      ) : null}

      {row.when ? <WhenChip label={row.when} tone={row.whenTone} /> : null}
    </div>
  );
}

export function AppPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_24px_70px_-24px_rgba(17,24,39,0.35)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-[0_24px_70px_-24px_rgba(0,0,0,0.8)]">
      {/* Window chrome, so the preview reads as an application rather than a
          decorative panel that happens to contain a list. */}
      <div className="flex h-9 items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3.5 dark:border-neutral-800 dark:bg-neutral-950/60">
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        <span className="mx-auto rounded-md bg-white px-3 py-0.5 text-[10px] text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500">
          dodone.app/today
        </span>
      </div>

      <div className="flex">
        {/* Sidebar — hidden on narrow screens, where the list is the point. */}
        <div className="hidden w-40 shrink-0 border-r border-neutral-200 bg-neutral-50 p-2.5 sm:block dark:border-neutral-800 dark:bg-neutral-950/40">
          <div className="mb-2.5 flex items-center gap-2 rounded-lg bg-indigo-500 px-2.5 py-1.5 text-[11px] font-semibold text-white">
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              aria-hidden
            >
              <path strokeLinecap="round" d="M12 5v14m7-7H5" />
            </svg>
            New task
          </div>
          {NAV.map((item) => (
            <div
              key={item.label}
              className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
                item.active
                  ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              <span>{item.label}</span>
              {item.count ? (
                <span className="text-[10px] text-neutral-400">
                  {item.count}
                </span>
              ) : null}
            </div>
          ))}
          <div className="mt-4 mb-1 px-2.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">
            Projects
          </div>
          {PROJECTS.map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-neutral-500 dark:text-neutral-400"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              {p.name}
            </div>
          ))}
        </div>

        {/* Main column */}
        <div className="min-w-0 flex-1 p-3.5 sm:p-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              Today
            </h3>
            <span className="text-[11px] text-neutral-400">
              6 tasks · 3 meetings
            </span>
          </div>

          {/* The day's meetings, above the tasks — the real Today view puts
              them here for the same reason: the gaps between them are the
              time you actually have. */}
          <div className="mb-3.5 flex gap-1.5 overflow-hidden">
            {[
              { t: "9:00", n: "Standup", c: "#6366f1" },
              { t: "11:00", n: "1:1 Priya", c: "#10b981" },
              { t: "12:30", n: "Lunch", c: "#f59e0b" },
            ].map((e) => (
              <div
                key={e.n}
                className="min-w-0 flex-1 rounded-lg border-l-2 bg-neutral-50 px-2 py-1.5 dark:bg-neutral-800/50"
                style={{ borderColor: e.c }}
              >
                <div className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400">
                  {e.t}
                </div>
                <div className="truncate text-[11px] text-neutral-700 dark:text-neutral-300">
                  {e.n}
                </div>
              </div>
            ))}
          </div>

          <div className="mb-1 flex items-center gap-2 px-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">
              Focus
            </span>
            <span className="h-px flex-1 bg-neutral-100 dark:bg-neutral-800" />
          </div>
          <div className="mb-3">
            {FOCUS.map((row) => (
              <TaskRow key={row.title} row={row} />
            ))}
          </div>

          <div className="mb-1 flex items-center gap-2 px-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
              Rest of today
            </span>
            <span className="h-px flex-1 bg-neutral-100 dark:bg-neutral-800" />
          </div>
          <div>
            {REST.map((row) => (
              <TaskRow key={row.title} row={row} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
