"use client";

import { useMemo, useRef, useState } from "react";
import {
  PRIORITY_CONFIG,
  QUICK_SCHEDULE,
  formatScheduleHint,
  resolveQuickSchedule,
  type ParsedTask,
  type Project,
  type TaskPriority,
} from "@do-done/shared";
import { formatRrule } from "@do-done/task-engine";
import type { DayBusyness } from "@do-done/api-client";
import {
  ESTIMATE_OPTIONS,
  MonthGrid,
  PRIORITY_OPTIONS,
  PickerPopover,
  WEEKDAYS,
  useClickOutside,
} from "./task-edit-modal-v2";
import { ProjectPickerPopover } from "./project-picker";

export const PRIORITY_DOT: Record<TaskPriority, string> = {
  p1: "bg-red-500",
  p2: "bg-amber-500",
  p3: "bg-indigo-500",
  p4: "bg-neutral-400",
};

/** Tiny stroke icon used to label a chip (calendar / flag / folder / clock). */
function ChipIcon({ d }: { d: string }) {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const ICON = {
  calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  flag: "M3 21v-7m0 0V5a2 2 0 012-2h6l1 2h6l-2 4 2 4h-7l-1-2H5a2 2 0 00-2 2z",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
} as const;

/** Shared pill button for a quick-add attribute selector. */
export function ChipButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
          : "border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {icon ? (
        <span className="-ml-0.5 flex items-center opacity-80">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}

/**
 * The arbitrary-date half of the Date chip: a scrolling run of month grids,
 * reusing the full editor's own `MonthGrid` so a date picked here looks and
 * behaves exactly like one picked there. No busyness — quick-add has no task
 * to fetch it for, and the chip is a capture affordance, not a planning one.
 */
function MonthScroller({
  selectedDate,
  onPick,
}: {
  selectedDate: string | null;
  onPick: (date: string) => void;
}) {
  const [monthsAhead, setMonthsAhead] = useState(5);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const todayStr = useMemo(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
      t.getDate()
    ).padStart(2, "0")}`;
  }, []);

  const months = useMemo(() => {
    const now = new Date();
    const out: { year: number; month: number }[] = [];
    for (let i = 0; i <= monthsAhead; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      out.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return out;
  }, [monthsAhead]);

  const noSpan = useMemo(() => new Set<string>(), []);
  const noSpanList = useMemo<string[]>(() => [], []);
  const noBusy = useMemo(() => new Map<string, DayBusyness>(), []);

  return (
    <div className="w-[252px] pb-2">
      <div className="grid grid-cols-7 gap-0.5 px-2 pb-1">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="text-center text-[9px] font-bold uppercase tracking-wider text-neutral-400"
          >
            {w.slice(0, 1)}
          </div>
        ))}
      </div>
      {/* The px-2 lives here, not on the wrapper: MonthGrid's sticky month
          label is `-mx-2`, so it needs this element's padding to cancel
          against — otherwise it overhangs and the popover scrolls sideways. */}
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120)
            setMonthsAhead((n) => n + 3);
        }}
        className="max-h-[260px] overflow-y-auto px-2"
      >
        {months.map((m) => (
          <MonthGrid
            key={`${m.year}-${m.month}`}
            year={m.year}
            month={m.month}
            todayStr={todayStr}
            selectedDate={selectedDate}
            spanDates={noSpan}
            spanList={noSpanList}
            busyByDate={noBusy}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

export function ScheduleChip({
  scheduledDate,
  onChange,
}: {
  scheduledDate: string | null;
  onChange: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // The quick options and the month grid share one popover; "Pick a date…"
  // swaps the body rather than opening a second layer over the first.
  const [picking, setPicking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => {
    setOpen(false);
    setPicking(false);
  });

  // Every quick option resolves to a concrete local date — DoDone has no soft
  // buckets. Resolved once when the chip opens.
  const options = useMemo(
    () => QUICK_SCHEDULE.map((o) => ({ ...o, date: resolveQuickSchedule(o.key) })),
    []
  );

  const label = scheduledDate
    ? options.find((o) => o.date === scheduledDate)?.label ?? formatScheduleHint(scheduledDate)
    : "Date";

  function close() {
    setOpen(false);
    setPicking(false);
  }

  return (
    <div className="relative" ref={ref}>
      <ChipButton
        active={scheduledDate != null}
        onClick={() => {
          setPicking(false);
          setOpen((o) => !o);
        }}
        icon={<ChipIcon d={ICON.calendar} />}
      >
        {label}
      </ChipButton>
      {open && picking ? (
        <div
          role="dialog"
          aria-label="Pick a date"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setPicking(false);
            }
          }}
          className="absolute left-0 top-full z-20 mt-2 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_12px_24px_rgba(17,24,39,0.10),0_2px_6px_rgba(17,24,39,0.05)] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="text-[11px] font-medium text-neutral-500 transition-colors hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              ← Back
            </button>
            {scheduledDate ? (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  close();
                }}
                className="text-[11px] font-medium text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                Clear
              </button>
            ) : null}
          </div>
          <MonthScroller
            selectedDate={scheduledDate}
            onPick={(date) => {
              onChange(date);
              close();
            }}
          />
        </div>
      ) : open ? (
        <PickerPopover
          ariaLabel="Date"
          onClose={close}
          options={[
            ...options.map((o) => ({
              key: o.key,
              code: "",
              label: o.label,
              hint: formatScheduleHint(o.date),
              selected: scheduledDate === o.date,
              onSelect: () => {
                onChange(scheduledDate === o.date ? null : o.date);
                close();
              },
              accentClass: "bg-indigo-500",
            })),
            {
              key: "custom",
              code: "",
              label: "Pick a date…",
              // A date none of the shortcuts cover still reads as chosen here,
              // which is the only row that can be showing it.
              selected:
                scheduledDate != null &&
                !options.some((o) => o.date === scheduledDate),
              onSelect: () => setPicking(true),
              accentClass: "bg-indigo-500",
            },
            {
              key: "none",
              code: "",
              label: "No date",
              selected: scheduledDate == null,
              onSelect: () => {
                onChange(null);
                close();
              },
              accentClass: "bg-neutral-400",
            },
          ]}
        />
      ) : null}
    </div>
  );
}

export function PriorityChip({
  value,
  onChange,
}: {
  value: TaskPriority | null;
  onChange: (p: TaskPriority | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const current = PRIORITY_OPTIONS.find((o) => o.value === value);
  return (
    <div className="relative" ref={ref}>
      <ChipButton
        active={value != null}
        onClick={() => setOpen((o) => !o)}
        icon={
          value ? (
            <span className={`h-2.5 w-2.5 rounded-full ${PRIORITY_DOT[value]}`} />
          ) : (
            <ChipIcon d={ICON.flag} />
          )
        }
      >
        {current ? current.code : "Priority"}
      </ChipButton>
      {open ? (
        <PickerPopover
          ariaLabel="Priority"
          onClose={() => setOpen(false)}
          options={PRIORITY_OPTIONS.map((o) => ({
            key: o.value,
            code: o.code,
            label: o.label,
            selected: value === o.value,
            onSelect: () => {
              onChange(value === o.value ? null : o.value);
              setOpen(false);
            },
            accentClass: PRIORITY_DOT[o.value],
          }))}
        />
      ) : null}
    </div>
  );
}

export function EstimateChip({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const current = ESTIMATE_OPTIONS.find((o) => o.minutes === value);
  return (
    <div className="relative" ref={ref}>
      <ChipButton
        active={value != null}
        onClick={() => setOpen((o) => !o)}
        icon={<ChipIcon d={ICON.clock} />}
      >
        {current ? current.short : "Estimate"}
      </ChipButton>
      {open ? (
        <PickerPopover
          ariaLabel="Estimate"
          onClose={() => setOpen(false)}
          options={ESTIMATE_OPTIONS.map((o) => ({
            key: String(o.minutes),
            code: o.code,
            label: o.label,
            selected: value === o.minutes,
            onSelect: () => {
              onChange(value === o.minutes ? null : o.minutes);
              setOpen(false);
            },
            accentClass: "bg-indigo-500",
          }))}
        />
      ) : null}
    </div>
  );
}

export function ProjectChip({
  projects,
  userId,
  selectedId,
  onSelect,
  onCreated,
}: {
  projects: Project[];
  userId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreated: (project: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const selected = projects.find((p) => p.id === selectedId) ?? null;
  return (
    <div className="relative" ref={ref}>
      <ChipButton
        active={selectedId != null}
        onClick={() => setOpen((o) => !o)}
        icon={
          selected ? (
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          ) : (
            <ChipIcon d={ICON.folder} />
          )
        }
      >
        {selected
          ? `${selected.icon ? `${selected.icon} ` : ""}${selected.name}`
          : "Project"}
      </ChipButton>
      {open ? (
        <ProjectPickerPopover
          projects={projects}
          selectedId={selectedId}
          userId={userId}
          onSelect={(id) => {
            onSelect(id);
            setOpen(false);
          }}
          onCreated={onCreated}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The When / Priority / Project / Estimate chip row shared by every quick-add
 * surface. The Project chip is omitted when there's no signed-in user or
 * project list (e.g. Storybook without a provider).
 */
export function QuickAddChipRow({
  priority,
  setPriority,
  duration,
  setDuration,
  scheduledDate,
  setScheduledDate,
  projectId,
  setProjectId,
  projects,
  userId,
  onCreatedProject,
}: {
  priority: TaskPriority | null;
  setPriority: (p: TaskPriority | null) => void;
  duration: number | null;
  setDuration: (m: number | null) => void;
  scheduledDate: string | null;
  setScheduledDate: (d: string | null) => void;
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  projects: Project[];
  userId: string | null;
  onCreatedProject?: (project: Project) => void;
}) {
  return (
    <>
      <ScheduleChip scheduledDate={scheduledDate} onChange={setScheduledDate} />
      <PriorityChip value={priority} onChange={setPriority} />
      {userId ? (
        <ProjectChip
          projects={projects}
          userId={userId}
          selectedId={projectId}
          onSelect={setProjectId}
          onCreated={(p) => {
            onCreatedProject?.(p);
            setProjectId(p.id);
          }}
        />
      ) : null}
      <EstimateChip value={duration} onChange={setDuration} />
    </>
  );
}

/**
 * Read-only preview of what the natural-language text parsed into. By default
 * it shows every field; pass `omitChipFields` on surfaces that already expose
 * When / Priority / Estimate as chips, so the preview only echoes the fields
 * the chips don't cover (deadline, tags, recurrence).
 */
export function ParsedPreview({
  parsed,
  omitChipFields = false,
  className = "",
}: {
  parsed: ParsedTask;
  omitChipFields?: boolean;
  className?: string;
}) {
  const chips: React.ReactNode[] = [];
  if (!omitChipFields && parsed.priority)
    chips.push(
      <span
        key="pri"
        className="rounded-full px-2 py-0.5 font-medium"
        style={{
          color: PRIORITY_CONFIG[parsed.priority].color,
          backgroundColor: PRIORITY_CONFIG[parsed.priority].color + "15",
        }}
      >
        {PRIORITY_CONFIG[parsed.priority].label}
      </span>
    );
  if (!omitChipFields && parsed.scheduled_date)
    chips.push(
      <span
        key="when"
        className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
      >
        {parsed.scheduled_date}
        {parsed.scheduled_time ? ` ${parsed.scheduled_time}` : ""}
      </span>
    );
  // Only present when a typed `#name` / `/name` matched a real project, and
  // `parsed.project` is then that project's own name — so this echoes what will
  // actually be set, not the token as typed.
  if (parsed.project_id && parsed.project)
    chips.push(
      <span
        key="project"
        className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
      >
        #{parsed.project}
      </span>
    );
  if (parsed.deadline_date)
    chips.push(
      <span
        key="deadline"
        className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
      >
        by {parsed.deadline_date}
        {parsed.deadline_time ? ` ${parsed.deadline_time}` : ""}
      </span>
    );
  parsed.tags?.forEach((tag) =>
    chips.push(
      <span
        key={`tag-${tag}`}
        className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
      >
        #{tag}
      </span>
    )
  );
  if (!omitChipFields && parsed.duration_minutes)
    chips.push(
      <span
        key="dur"
        className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
      >
        {parsed.duration_minutes}min
      </span>
    );
  if (parsed.recurrence_rule)
    chips.push(
      <span
        key="rec"
        className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-600 dark:bg-violet-950 dark:text-violet-400"
      >
        {formatRrule(parsed.recurrence_rule)}
      </span>
    );
  if (chips.length === 0) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500 ${className}`}
    >
      {chips}
    </div>
  );
}
