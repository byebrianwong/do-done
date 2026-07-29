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
import {
  ESTIMATE_OPTIONS,
  PRIORITY_OPTIONS,
  PickerPopover,
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

export function WhenChip({
  whenDate,
  onChange,
}: {
  whenDate: string | null;
  onChange: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  // Every quick option resolves to a concrete local date — DoDone has no soft
  // buckets. Resolved once when the chip opens.
  const options = useMemo(
    () => QUICK_SCHEDULE.map((o) => ({ ...o, date: resolveQuickSchedule(o.key) })),
    []
  );

  const label = whenDate
    ? options.find((o) => o.date === whenDate)?.label ?? formatScheduleHint(whenDate)
    : "Date";

  return (
    <div className="relative" ref={ref}>
      <ChipButton
        active={whenDate != null}
        onClick={() => setOpen((o) => !o)}
        icon={<ChipIcon d={ICON.calendar} />}
      >
        {label}
      </ChipButton>
      {open ? (
        <PickerPopover
          ariaLabel="Date"
          onClose={() => setOpen(false)}
          options={[
            ...options.map((o) => ({
              key: o.key,
              code: "",
              label: o.label,
              hint: formatScheduleHint(o.date),
              selected: whenDate === o.date,
              onSelect: () => {
                onChange(whenDate === o.date ? null : o.date);
                setOpen(false);
              },
              accentClass: "bg-indigo-500",
            })),
            {
              key: "none",
              code: "",
              label: "No date",
              selected: whenDate == null,
              onSelect: () => {
                onChange(null);
                setOpen(false);
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
  whenDate,
  setWhenDate,
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
  whenDate: string | null;
  setWhenDate: (d: string | null) => void;
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  projects: Project[];
  userId: string | null;
  onCreatedProject?: (project: Project) => void;
}) {
  return (
    <>
      <WhenChip whenDate={whenDate} onChange={setWhenDate} />
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
  if (!omitChipFields && parsed.when_date)
    chips.push(
      <span
        key="when"
        className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
      >
        {parsed.when_date}
      </span>
    );
  if (parsed.due_date)
    chips.push(
      <span
        key="due"
        className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
      >
        due {parsed.due_date}
        {parsed.due_time ? ` ${parsed.due_time}` : ""}
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
