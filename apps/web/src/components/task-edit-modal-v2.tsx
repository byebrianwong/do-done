"use client";

/**
 * Task edit modal V2 — round-7 design.
 * See docs/task-input-design/round7-desktop.html for the visual reference.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  STATUS_ORDER,
  formatWhenTime,
  type Project,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@do-done/shared";
import {
  useAutoSaveTask,
  TasksApi,
  type DayBusyness,
} from "@do-done/api-client";
import { createClientSupabase } from "@/lib/supabase/client";
import { ProjectPickerPopover } from "./project-picker";

// ─── Constants ─────────────────────────────────────────────

// Map minutes → bar index for display. Exported so the task row's inline
// estimate editor can reuse the same bucket boundaries.
export function estimateBarIndex(minutes: number | null): number {
  if (!minutes) return -1;
  if (minutes <= 30) return 0;
  if (minutes <= 60) return 1;
  if (minutes <= 120) return 2;
  if (minutes <= 240) return 3;
  if (minutes <= 480) return 4;
  return 5;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  // Sunday-start. Hour 0 local.
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

// English relative-date phrase from a YYYY-MM-DD string. Returns null if
// the input isn't parseable. Pure function — `todayStr` is injected so
// tests can pin "now".
function formatRelative(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return "today";
  const d1 = new Date(dateStr + "T00:00:00");
  const d2 = new Date(todayStr + "T00:00:00");
  const diff = Math.round((d1.getTime() - d2.getTime()) / 86400000);
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff >= 2 && diff <= 6) return `in ${diff} days`;
  if (diff === 7) return "in 1 week";
  if (diff > 7 && diff <= 27) {
    const w = Math.round(diff / 7);
    return `in ${w} weeks`;
  }
  if (diff > 27) {
    const m = Math.round(diff / 30);
    return m === 1 ? "in 1 month" : `in ${m} months`;
  }
  if (diff <= -2 && diff >= -6) return `${-diff} days ago`;
  if (diff < -6 && diff >= -27) return `${Math.round(-diff / 7)} weeks ago`;
  const m = Math.round(-diff / 30);
  return m === 1 ? "1 month ago" : `${m} months ago`;
}

// ─── Sub-components ────────────────────────────────────────

function SaveStatusDot({
  saving,
  lastSavedAt,
  error,
}: {
  saving: boolean;
  lastSavedAt: Date | null;
  error: Error | null;
}) {
  const tone = error
    ? "bg-red-500"
    : saving
      ? "bg-amber-500"
      : "bg-green-500";
  const label = error
    ? "save failed"
    : saving
      ? "saving…"
      : lastSavedAt
        ? "auto-save"
        : "auto-save";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-500"
      title={error ? error.message : "Changes auto-save"}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${tone} ${
          saving || lastSavedAt ? "animate-pulse" : ""
        }`}
      />
      {label}
    </span>
  );
}

// ── Priority / Estimate metadata ───────────────────────

export const PRIORITY_OPTIONS: { value: TaskPriority; code: string; label: string }[] = [
  { value: "p1", code: "P1", label: "Urgent" },
  { value: "p2", code: "P2", label: "High" },
  { value: "p3", code: "P3", label: "Medium" },
  { value: "p4", code: "P4", label: "Low" },
];

export const ESTIMATE_OPTIONS: {
  minutes: number;
  code: string;
  label: string;
  short: string;
}[] = [
  { minutes: 30, code: "XS", label: "30 min or less", short: "≤30m" },
  { minutes: 60, code: "S", label: "~1 hr", short: "1h" },
  { minutes: 120, code: "M", label: "~2 hr", short: "2h" },
  { minutes: 240, code: "ML", label: "~4 hr", short: "4h" },
  { minutes: 480, code: "L", label: "~8 hr", short: "8h" },
  { minutes: 960, code: "XL", label: "16 hrs or more", short: "≥16h" },
];

// Hitbox tuning — column hitbox is much larger than the visible bar so a
// click anywhere in the vertical column (even above a short target) selects
// that value. Previously bars were 4×17px → 68px² targets; now they're
// 14×28px → 392px² each.
const PRI_COL_WIDTH = 14;
const PRI_COL_HEIGHT = 28;
const PRI_BAR_HEIGHTS = ["h-[8px]", "h-[14px]", "h-[20px]", "h-[26px]"];

const EST_COL_WIDTH = 14;
const EST_COL_HEIGHT = 28;
const EST_BAR_HEIGHTS = [
  "h-[6px]",
  "h-[11px]",
  "h-[15px]",
  "h-[19px]",
  "h-[23px]",
  "h-[26px]",
];

const PRIORITY_BAR_COUNTS = { p1: 4, p2: 3, p3: 2, p4: 1 } as const;
const PRIORITY_BAR_COLORS = {
  p1: "bg-red-500",
  p2: "bg-amber-500",
  p3: "bg-indigo-500",
  p4: "bg-neutral-400",
} as const;

function PrioritySignal({
  value,
  hovered,
  onChange,
  onHover,
}: {
  value: TaskPriority;
  hovered: TaskPriority | null;
  onChange: (p: TaskPriority) => void;
  onHover: (p: TaskPriority | null) => void;
}) {
  // While hovering, show what the priority WOULD look like if clicked
  // (faded). Mouseleave restores the actual selection.
  const display = hovered ?? value;
  const litCount = PRIORITY_BAR_COUNTS[display];
  const colorClass = PRIORITY_BAR_COLORS[display];
  const previewing = hovered !== null && hovered !== value;
  return (
    <div
      className="inline-flex items-end gap-[3px]"
      role="radiogroup"
      aria-label="Priority"
      style={{ height: PRI_COL_HEIGHT }}
      onMouseLeave={() => onHover(null)}
    >
      {[0, 1, 2, 3].map((i) => {
        const p = (["p4", "p3", "p2", "p1"] as TaskPriority[])[i];
        const lit = i < litCount;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(p)}
            onMouseEnter={() => onHover(p)}
            aria-label={`Set priority ${PRIORITY_CONFIG[p].label}`}
            aria-pressed={value === p}
            title={`P${4 - i} · ${PRIORITY_CONFIG[p].label}`}
            className="group flex items-end justify-center rounded-md p-0 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            style={{
              width: PRI_COL_WIDTH,
              height: PRI_COL_HEIGHT,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <span
              className={`block w-[6px] rounded-[2px] transition-all ${PRI_BAR_HEIGHTS[i]} ${
                lit
                  ? `${colorClass} ${previewing ? "opacity-50" : ""}`
                  : "bg-neutral-200 dark:bg-neutral-800"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

function EstimateEqualizer({
  value,
  hovered,
  onChange,
  onHover,
}: {
  value: number | null;
  hovered: number | null;
  onChange: (minutes: number) => void;
  onHover: (minutes: number | null) => void;
}) {
  // While hovering, preview which bars WOULD light at faded opacity.
  const displayMinutes = hovered ?? value;
  const displayIdx = estimateBarIndex(displayMinutes);
  const activeIdx = estimateBarIndex(value);
  const previewing = hovered !== null && hovered !== value;
  return (
    <div
      className="inline-flex items-end gap-[3px]"
      role="radiogroup"
      aria-label="Estimate"
      style={{ height: EST_COL_HEIGHT }}
      onMouseLeave={() => onHover(null)}
    >
      {ESTIMATE_OPTIONS.map((b, i) => {
        const lit = i <= displayIdx;
        return (
          <button
            key={b.minutes}
            type="button"
            onClick={() => onChange(b.minutes)}
            onMouseEnter={() => onHover(b.minutes)}
            aria-label={`Set estimate to ${b.code} (${b.label})`}
            aria-pressed={i === activeIdx}
            title={`${b.code} · ${b.label}`}
            className="group flex items-end justify-center rounded-md p-0 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            style={{
              width: EST_COL_WIDTH,
              height: EST_COL_HEIGHT,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <span
              className={`block w-[6px] rounded-[2px] transition-all ${EST_BAR_HEIGHTS[i]} ${
                lit
                  ? `bg-indigo-500 ${previewing ? "opacity-50" : ""}`
                  : "bg-neutral-200 dark:bg-neutral-800"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

// ── Priority / Estimate field wrappers (label opens popover picker) ────────

function StatusField({
  value,
  onChange,
}: {
  value: TaskStatus;
  onChange: (s: TaskStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));
  const cfg = STATUS_CONFIG[value];

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <span className="rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
        Status
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: cfg.color }}
        />
        {cfg.label}
        <span className="text-neutral-400">▾</span>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Status options"
          className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
        >
          {STATUS_ORDER.map((s) => {
            const c = STATUS_CONFIG[s];
            const selected = s === value;
            return (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  selected
                    ? "bg-neutral-100 dark:bg-neutral-900"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-neutral-800 dark:text-neutral-200">
                  {c.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ProjectField({
  projects,
  value,
  userId,
  onChange,
  onCreated,
}: {
  projects: Project[];
  value: string | null;
  userId: string;
  onChange: (projectId: string | null) => void;
  onCreated: (project: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));
  const selected = value ? projects.find((p) => p.id === value) ?? null : null;

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <span className="rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
        Project
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        {selected ? (
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: selected.color }}
          />
        ) : (
          <span className="h-2 w-2 rounded-full border border-dashed border-neutral-400" />
        )}
        <span className={selected ? "" : "text-neutral-400"}>
          {selected
            ? `${selected.icon ? `${selected.icon} ` : ""}${selected.name}`
            : "No project"}
        </span>
        <span className="text-neutral-400">▾</span>
      </button>
      {open ? (
        <ProjectPickerPopover
          projects={projects}
          selectedId={value}
          userId={userId}
          onSelect={onChange}
          onCreated={onCreated}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function PriorityField({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<TaskPriority | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));

  // Clicking the current value clears to p4 (the "no priority" default —
  // the priority chip in the title bar is hidden for p4).
  const handleChange = (p: TaskPriority) => {
    onChange(p === value ? "p4" : p);
  };

  const previewLabel =
    hovered !== null && hovered !== value
      ? PRIORITY_CONFIG[hovered].label
      : null;

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        Pri
      </button>
      <PrioritySignal
        value={value}
        hovered={hovered}
        onChange={handleChange}
        onHover={setHovered}
      />
      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
        {PRIORITY_CONFIG[value].label}
      </span>
      {previewLabel ? (
        <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
          → {previewLabel}
        </span>
      ) : null}
      {open ? (
        <PickerPopover
          ariaLabel="Priority options"
          options={PRIORITY_OPTIONS.map((p) => ({
            key: p.value,
            code: p.code,
            label: p.label,
            selected: p.value === value,
            onSelect: () => {
              handleChange(p.value);
              setOpen(false);
            },
            accentClass: {
              p1: "bg-red-500",
              p2: "bg-amber-500",
              p3: "bg-indigo-500",
              p4: "bg-neutral-400",
            }[p.value],
          }))}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function formatEstimateShort(minutes: number): string {
  return minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
}

function EstimateField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));
  const activeIdx = estimateBarIndex(value);

  // Clicking the current bar clears to null. Otherwise set to the new value.
  const handleChange = (minutes: number) => {
    onChange(minutes === value ? null : minutes);
  };

  const previewLabel =
    hovered !== null && hovered !== value ? formatEstimateShort(hovered) : null;

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        Est
      </button>
      <EstimateEqualizer
        value={value}
        hovered={hovered}
        onChange={handleChange}
        onHover={setHovered}
      />
      <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">
        {value ? formatEstimateShort(value) : "—"}
      </span>
      {previewLabel ? (
        <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
          → {previewLabel}
        </span>
      ) : null}
      {open ? (
        <PickerPopover
          ariaLabel="Estimate options"
          options={ESTIMATE_OPTIONS.map((b, i) => ({
            key: String(b.minutes),
            code: b.code,
            label: b.label,
            selected: i === activeIdx,
            onSelect: () => {
              handleChange(b.minutes);
              setOpen(false);
            },
            accentClass: "bg-indigo-500",
          }))}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ── Picker popover ─────────────────────────────────────

export interface PickerOption {
  key: string;
  code: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  accentClass: string;
}

export function PickerPopover({
  options,
  onClose,
  ariaLabel,
}: {
  options: PickerOption[];
  onClose: () => void;
  ariaLabel: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className="absolute left-0 top-full z-20 mt-2 min-w-[180px] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_12px_24px_rgba(17,24,39,0.10),0_2px_6px_rgba(17,24,39,0.05)] dark:border-neutral-800 dark:bg-neutral-950"
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="option"
          aria-selected={opt.selected}
          onClick={opt.onSelect}
          className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900 ${
            opt.selected ? "bg-indigo-50/60 dark:bg-indigo-950/40" : ""
          }`}
        >
          <span
            className={`inline-flex h-2 w-2 shrink-0 rounded-full ${opt.accentClass}`}
            aria-hidden
          />
          <span className="w-[26px] text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {opt.code}
          </span>
          <span className="text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
            {opt.label}
          </span>
          {opt.selected ? (
            <span
              aria-hidden
              className="ml-auto text-[11px] font-semibold text-indigo-600 dark:text-indigo-400"
            >
              ✓
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// Closes the popover when the user clicks anywhere outside `ref`.
export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  onOutside: () => void
) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        onOutside();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref, onOutside]);
}

function DoneButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Close (all changes auto-saved)"
      className="group inline-flex items-center gap-2.5 rounded-lg bg-indigo-500 px-3.5 py-2 text-white shadow-lg shadow-indigo-500/30 transition-colors hover:bg-indigo-600"
    >
      <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-green-500 text-[12px] font-bold">
        ✓
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[13px] font-bold">Done</span>
        <span className="text-[10px] font-medium text-white/75">all saved</span>
      </span>
      <span className="ml-0.5 rounded bg-white/20 px-1.5 text-[10px] font-mono">
        Esc
      </span>
    </button>
  );
}

// ─── When calendar ──────────────────────────────────────────

function busyDotClass(item: { type: "task" | "event"; priority?: TaskPriority }): string {
  if (item.type === "event") {
    return "bg-transparent border-[1.5px] border-slate-400";
  }
  const color = {
    p1: "bg-red-500",
    p2: "bg-amber-500",
    p3: "bg-indigo-500",
    p4: "bg-neutral-400",
  }[item.priority ?? "p3"];
  return color;
}

function busyDotWidthClass(minutes: number): string {
  if (minutes <= 30) return "w-[5px]";
  if (minutes <= 60) return "w-[9px]";
  if (minutes <= 120) return "w-[14px]";
  if (minutes <= 240) return "w-[20px]";
  return "w-[28px]";
}

// ── Month grid for the "See more dates" scroll view ──

function MonthGrid({
  year,
  month,
  todayStr,
  selectedDate,
  busyByDate,
  onPick,
}: {
  year: number;
  month: number; // 0-indexed
  todayStr: string;
  selectedDate: string | null;
  busyByDate: Map<string, DayBusyness>;
  onPick: (date: string) => void;
}) {
  const first = new Date(year, month, 1);
  const firstDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<{ date: string | null; day: number }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ date: null, day: 0 });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(
      d
    ).padStart(2, "0")}`;
    cells.push({ date, day: d });
  }
  // Pad trailing cells so each month ends on a complete week.
  while (cells.length % 7 !== 0) cells.push({ date: null, day: 0 });

  const monthLabel = first.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="pt-1.5">
      <div className="sticky top-0 z-10 -mx-2 mb-1 bg-neutral-50/95 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500 backdrop-blur dark:bg-neutral-900/95 dark:text-neutral-400">
        {monthLabel}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, i) => {
          if (!c.date) {
            return <div key={`pad-${i}`} className="h-7" />;
          }
          const date = c.date;
          const isPast = date < todayStr;
          const isToday = date === todayStr;
          const isActive = selectedDate === date;
          const day = busyByDate.get(date);
          const hasBusy = (day?.items?.length ?? 0) > 0;
          return (
            <button
              type="button"
              key={date}
              disabled={isPast}
              onClick={() => {
                if (!isPast) onPick(date);
              }}
              className={`relative flex h-7 items-center justify-center rounded-md text-[12px] font-medium transition-colors ${
                isPast
                  ? "cursor-not-allowed text-neutral-300 dark:text-neutral-700"
                  : isActive
                    ? "bg-indigo-500 text-white shadow-sm shadow-indigo-500/40"
                    : isToday
                      ? "ring-1 ring-inset ring-indigo-400 text-indigo-700 dark:text-indigo-300"
                      : "text-neutral-700 hover:bg-white hover:ring-1 hover:ring-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:ring-neutral-700"
              }`}
            >
              {c.day}
              {hasBusy && !isActive && !isPast ? (
                <span
                  className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${
                    isToday ? "bg-indigo-500" : "bg-neutral-400 dark:bg-neutral-500"
                  }`}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Progressive disclosure for the date picker.
type CalendarExpansion = "collapsed" | "two-weeks" | "months";

function WhenCalendar({
  whenDate,
  dueDate,
  busyness,
  onPickDate,
  onChangeDueDate,
}: {
  whenDate: string | null;
  dueDate: string | null;
  busyness: DayBusyness[];
  onPickDate: (date: string) => void;
  onChangeDueDate: (v: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<CalendarExpansion>("collapsed");
  // Number of months visible in the scroll view. Grows when the user
  // scrolls near the bottom.
  const [monthsAhead, setMonthsAhead] = useState(6);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const weekStart = useMemo(() => startOfWeek(today), [today]);
  const todayStr = ymd(today);
  // "Next week" is a concrete date — exactly 7 days from today — not a soft
  // bucket, so it survives as a real when_date.
  const nextWeekStr = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return ymd(d);
  }, [today]);

  // Special-date labels. Order = priority (active > today > tomorrow > …).
  // Each entry: { date: YYYY-MM-DD, label: short text }. The set is rendered
  // beneath the day number; only one label per cell.
  const specialLabels = useMemo(() => {
    const labels = new Map<string, string>();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    labels.set(ymd(tomorrow), "tomorrow");

    // "This weekend" = upcoming Saturday in the current Sunday-start week.
    // Skip when today IS Saturday (covered by "today").
    if (today.getDay() !== 6) {
      const sat = new Date(weekStart);
      sat.setDate(sat.getDate() + 6);
      const key = ymd(sat);
      // Don't override "tomorrow" if today is Friday.
      if (!labels.has(key)) labels.set(key, "weekend");
    }

    const nextWk = new Date(today);
    nextWk.setDate(nextWk.getDate() + 7);
    labels.set(ymd(nextWk), "next wk");

    // "Next weekend" = the Saturday after this weekend.
    const nextWknd = new Date(weekStart);
    nextWknd.setDate(nextWknd.getDate() + 13);
    const nextWkndKey = ymd(nextWknd);
    if (!labels.has(nextWkndKey)) labels.set(nextWkndKey, "next wknd");

    // Always-set "today" last so it wins over any same-date entries above.
    labels.set(todayStr, "today");
    return labels;
  }, [today, weekStart, todayStr]);

  // Visible week rows depend on expansion. "months" still shows the current
  // week as an at-a-glance row above the scrollable months.
  const cells = useMemo(() => {
    const weeks = expanded === "two-weeks" ? 2 : 1;
    const out: { date: string; weekday: number; weekIdx: number }[] = [];
    for (let w = 0; w < weeks; w++) {
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + w * 7 + i);
        out.push({ date: ymd(d), weekday: i, weekIdx: w });
      }
    }
    return out;
  }, [weekStart, expanded]);

  // Months for the scroll view — start at the current month so the user
  // sees context for the visible week.
  const months = useMemo(() => {
    const out: { year: number; month: number }[] = [];
    const startY = today.getFullYear();
    const startM = today.getMonth();
    for (let i = 0; i <= monthsAhead; i++) {
      const d = new Date(startY, startM + i, 1);
      out.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return out;
  }, [today, monthsAhead]);

  const busyByDate = useMemo(() => {
    const m = new Map<string, DayBusyness>();
    for (const d of busyness) m.set(d.date, d);
    return m;
  }, [busyness]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      setMonthsAhead((n) => n + 3);
    }
  }, []);

  return (
    <div>
      {/* Column headers */}
      <div className="grid grid-cols-7 gap-1 pb-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`text-center text-[10px] font-bold uppercase tracking-wider ${
              i === 0 || i === 6
                ? "text-neutral-500"
                : "text-neutral-400"
            }`}
          >
            {w}
          </div>
        ))}
      </div>
      {/* Current-week cells */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => {
          const isWeekend = c.weekday === 0 || c.weekday === 6;
          const isPast = c.date < todayStr;
          const isToday = c.date === todayStr;
          const isActive = whenDate === c.date;
          const numLabel = parseInt(c.date.split("-")[2], 10);
          const day = busyByDate.get(c.date);
          const dots = (day?.items ?? []).slice(0, 8);
          const specialLabel = isActive
            ? "selected"
            : specialLabels.get(c.date) ?? null;
          // Highlight tone for the label.
          const labelTone = isActive
            ? "text-indigo-100"
            : isToday
              ? "text-indigo-600 dark:text-indigo-400"
              : "text-neutral-400 dark:text-neutral-500";
          return (
            <button
              type="button"
              key={c.date}
              disabled={isPast}
              onClick={() => {
                if (!isPast) onPickDate(c.date);
              }}
              className={`relative flex aspect-square flex-col items-center justify-start overflow-hidden rounded-lg border-[1.5px] px-1 pt-2.5 pb-1.5 transition-all ${
                isPast
                  ? "opacity-30 cursor-not-allowed border-transparent bg-neutral-50 dark:bg-neutral-900"
                  : isActive
                    ? "border-indigo-500 bg-indigo-500 shadow-lg shadow-indigo-500/40 ring-2 ring-indigo-500/20 dark:bg-indigo-500"
                    : isToday
                      ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
                      : isWeekend
                        ? "border-transparent bg-indigo-500/[0.035] hover:border-neutral-200 hover:bg-white dark:hover:bg-neutral-900"
                        : "border-transparent bg-neutral-50 hover:border-neutral-200 hover:bg-white dark:bg-neutral-900/50 dark:hover:bg-neutral-900"
              }`}
            >
              {isToday && !isActive && (
                <span className="absolute top-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-indigo-500" />
              )}
              <span
                className={`text-sm font-semibold leading-none ${
                  isActive
                    ? "text-white"
                    : "text-neutral-900 dark:text-neutral-100"
                }`}
              >
                {numLabel}
              </span>
              {specialLabel ? (
                <span
                  className={`mt-0.5 text-[9px] font-medium leading-none tracking-wider ${labelTone}`}
                >
                  {specialLabel}
                </span>
              ) : null}
              <div className="mt-auto flex w-full flex-wrap items-end justify-center gap-[2px] pb-0.5 min-h-[14px]">
                {dots.map((item) => (
                  <span
                    key={item.id}
                    title={`${item.title} · ${item.duration_minutes}m`}
                    className={`h-[5px] rounded-[2.5px] ${
                      isActive
                        ? "bg-white/70"
                        : busyDotClass(item)
                    } ${busyDotWidthClass(item.duration_minutes)}`}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Action row: progressive expand + next week + due date */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {expanded !== "collapsed" ? (
          <button
            type="button"
            onClick={() =>
              setExpanded((e) =>
                e === "months" ? "two-weeks" : "collapsed"
              )
            }
            className="rounded-lg bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-white hover:ring-1 hover:ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            See less ⇡
          </button>
        ) : null}
        {expanded !== "months" ? (
          <button
            type="button"
            onClick={() =>
              setExpanded((e) =>
                e === "collapsed" ? "two-weeks" : "months"
              )
            }
            className="flex-1 min-w-[140px] rounded-lg bg-indigo-50 px-2 py-2 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300"
          >
            See more dates ⇣
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onPickDate(nextWeekStr)}
          className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            whenDate === nextWeekStr
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              : "bg-neutral-50 text-neutral-700 hover:bg-white hover:ring-1 hover:ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
        >
          Next week
        </button>
        <DueDateField value={dueDate} onChange={onChangeDueDate} />
      </div>

      {/* Expanded month scroll view */}
      {expanded === "months" ? (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="mt-3 max-h-[280px] overflow-y-auto overscroll-contain rounded-lg border border-neutral-100 bg-neutral-50/60 px-2 pb-2 dark:border-neutral-900 dark:bg-neutral-900/40 [scrollbar-color:rgb(212_212_212)_transparent] [scrollbar-width:thin] dark:[scrollbar-color:rgb(64_64_64)_transparent]"
        >
          {months.map((m) => (
            <MonthGrid
              key={`${m.year}-${m.month}`}
              year={m.year}
              month={m.month}
              todayStr={todayStr}
              selectedDate={whenDate}
              busyByDate={busyByDate}
              onPick={onPickDate}
            />
          ))}
          <div className="mt-2 text-center text-[10px] text-neutral-400">
            scroll for more
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Subtasks section ───────────────────────────────────────

function SubtaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const done = task.status === "done" || task.status === "cancelled";
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-900">
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? "Mark not done" : "Mark done"}
        aria-pressed={done}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors ${
          done
            ? "border-indigo-500 bg-indigo-500 text-white"
            : "border-neutral-300 hover:border-indigo-500 dark:border-neutral-700"
        }`}
      >
        {done ? <span className="text-[10px] leading-none">✓</span> : null}
      </button>
      <span
        className={`flex-1 truncate text-[13px] ${
          done
            ? "text-neutral-400 line-through dark:text-neutral-600"
            : "text-neutral-800 dark:text-neutral-200"
        }`}
      >
        {task.title}
      </span>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${task.title}`}
        className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[14px] leading-none text-neutral-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-neutral-600 dark:hover:bg-red-950"
      >
        ×
      </button>
    </div>
  );
}

function SubtasksSection({
  parentTask,
  tasksApi,
}: {
  parentTask: Task;
  tasksApi: TasksApi;
}) {
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await tasksApi.listSubtasks(parentTask.id);
      if (!cancelled) {
        setSubtasks(data);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parentTask.id, tasksApi]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  // DB trigger enforces depth ≤ 2, so depth 2 tasks can't have children.
  const canAdd = parentTask.depth < 2;

  const handleAdd = async () => {
    const title = draft.trim();
    if (!title) {
      setAdding(false);
      return;
    }
    const { data } = await tasksApi.create({
      title,
      parent_task_id: parentTask.id,
    });
    if (data) setSubtasks((prev) => [...prev, data]);
    setDraft("");
    // Keep the input open for rapid entry.
  };

  const handleToggle = async (st: Task) => {
    const next = st.status === "done" ? "not_started" : "done";
    const { data } = await tasksApi.update(st.id, { status: next });
    if (data) {
      setSubtasks((prev) => prev.map((s) => (s.id === data.id ? data : s)));
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await tasksApi.delete(id);
    if (!error) setSubtasks((prev) => prev.filter((s) => s.id !== id));
  };

  if (!canAdd && subtasks.length === 0 && loaded) return null;

  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
          Subtasks
        </span>
        {subtasks.length > 0 ? (
          <span className="text-[11px] font-medium text-neutral-500">
            {subtasks.filter((s) => s.status === "done").length}/{subtasks.length}
          </span>
        ) : null}
      </div>
      <div className="rounded-lg border border-neutral-100 bg-neutral-50/60 px-1.5 py-1.5 dark:border-neutral-900 dark:bg-neutral-900/40">
        {subtasks.map((st) => (
          <SubtaskRow
            key={st.id}
            task={st}
            onToggle={() => handleToggle(st)}
            onDelete={() => handleDelete(st.id)}
          />
        ))}
        {canAdd ? (
          adding ? (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-dashed border-neutral-300 dark:border-neutral-700" />
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAdd();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setDraft("");
                    setAdding(false);
                  }
                }}
                onBlur={() => {
                  if (draft.trim()) void handleAdd();
                  setAdding(false);
                }}
                placeholder="Subtask title…"
                className="flex-1 bg-transparent text-[13px] text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-200"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-neutral-500 transition-colors hover:bg-white hover:text-indigo-600 dark:hover:bg-neutral-900 dark:hover:text-indigo-400"
            >
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-dashed border-neutral-300 text-[11px] leading-none dark:border-neutral-700">
                +
              </span>
              Add subtask
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

// ─── Due date field ─────────────────────────────────────────

function CheckeredFlagIcon({ className }: { className?: string }) {
  // Minimal checkered flag: pole on left, 4×3 checkerboard panel.
  // Squares alternate currentColor / transparent — the parent's text color
  // drives the dark squares.
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
    >
      <path
        d="M3 2.25v11.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      {/* Row 1 */}
      <rect x="3.75" y="2.75" width="2" height="1.75" fill="currentColor" />
      <rect x="7.75" y="2.75" width="2" height="1.75" fill="currentColor" />
      <rect x="11.75" y="2.75" width="1.5" height="1.75" fill="currentColor" />
      {/* Row 2 (offset) */}
      <rect x="5.75" y="4.5" width="2" height="1.75" fill="currentColor" />
      <rect x="9.75" y="4.5" width="2" height="1.75" fill="currentColor" />
      {/* Row 3 */}
      <rect x="3.75" y="6.25" width="2" height="1.75" fill="currentColor" />
      <rect x="7.75" y="6.25" width="2" height="1.75" fill="currentColor" />
      <rect x="11.75" y="6.25" width="1.5" height="1.75" fill="currentColor" />
      {/* Flag outline */}
      <path
        d="M3.5 2.75h9.75v5.25H3.5z"
        stroke="currentColor"
        strokeWidth="0.85"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function formatDueShort(value: string): string {
  const d = new Date(value + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function DueDateField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const active = !!value;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={value ? `Due ${formatDueShort(value)}` : "Set due date"}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
          active
            ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900"
            : "bg-neutral-50 text-neutral-500 hover:bg-white hover:ring-1 hover:ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
      >
        <CheckeredFlagIcon className="h-3.5 w-3.5" />
        {active ? <span>Due {formatDueShort(value!)}</span> : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Due date"
          className="absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-neutral-200 bg-white p-3 shadow-[0_12px_24px_rgba(17,24,39,0.10),0_2px_6px_rgba(17,24,39,0.05)] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            <CheckeredFlagIcon className="h-3 w-3" /> Due date
          </div>
          <input
            ref={inputRef}
            type="date"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-[13px] text-neutral-800 outline-none focus:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          />
          <div className="mt-1.5 text-[10px] leading-snug text-neutral-400">
            Hard deadline — separate from when you plan to do it.
          </div>
          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              aria-label="Clear due date"
              className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              × Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

// Optional time-of-day for the when_date "do date". Mirrors DueDateField's
// popover shape but in indigo (the "when" accent) with a native time input —
// distinct from the amber/checkered-flag deadline styling. Only meaningful
// when a when_date is set, so the caller gates rendering on that.
function WhenTimeField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const active = !!value;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={value ? `At ${formatWhenTime(value)}` : "Set a time"}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
          active
            ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-900"
            : "bg-neutral-50 text-neutral-500 hover:bg-white hover:ring-1 hover:ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
      >
        <ClockIcon className="h-3.5 w-3.5" />
        <span>{active ? formatWhenTime(value!) : "Add time"}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Do time"
          className="absolute left-0 top-full z-20 mt-2 w-52 rounded-lg border border-neutral-200 bg-white p-3 shadow-[0_12px_24px_rgba(17,24,39,0.10),0_2px_6px_rgba(17,24,39,0.05)] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            <ClockIcon className="h-3 w-3" /> Time
          </div>
          <input
            ref={inputRef}
            type="time"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-[13px] text-neutral-800 outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          />
          <div className="mt-1.5 text-[10px] leading-snug text-neutral-400">
            Time you plan to start — optional.
          </div>
          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              aria-label="Clear time"
              className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              × Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Slash-command input ────────────────────────────────────

type ParsedToken = {
  kind: "priority" | "estimate" | "tag";
  label: string;
  toneClass: string;
  removable?: { tag: string };
};

// Shortcut maps — `#xs`/`#s`/`#m`/`#l`/`#xl`/`#xxl` set duration_minutes;
// `#p1`/`#p2`/`#p3`/`#p4` set priority. Anything else becomes a regular tag.
const ESTIMATE_SHORTCUTS: Record<string, number> = {
  xs: 30,
  s: 60,
  m: 120,
  l: 240,
  xl: 480,
  xxl: 960,
};
const PRIORITY_SHORTCUTS: Record<string, TaskPriority> = {
  p1: "p1",
  p2: "p2",
  p3: "p3",
  p4: "p4",
};

// Extract whitespace-terminated `#token` from text. Tokens are classified:
//   - estimate shortcut → durationMinutes
//   - priority shortcut → priority
//   - otherwise → tag
// Partial (unterminated) `#word` is left alone so the user can keep typing.
function extractCompletedTags(text: string): {
  stripped: string;
  tags: string[];
  priority?: TaskPriority;
  durationMinutes?: number;
} {
  const tags: string[] = [];
  let priority: TaskPriority | undefined;
  let durationMinutes: number | undefined;
  const re = /#(\w+)(\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1].toLowerCase();
    if (token in ESTIMATE_SHORTCUTS) {
      durationMinutes = ESTIMATE_SHORTCUTS[token];
    } else if (token in PRIORITY_SHORTCUTS) {
      priority = PRIORITY_SHORTCUTS[token];
    } else {
      tags.push(m[1]);
    }
  }
  if (
    tags.length === 0 &&
    priority === undefined &&
    durationMinutes === undefined
  ) {
    return { stripped: text, tags };
  }
  // Strip every completed `#token\s+` match — whether tag, priority, or
  // estimate — then collapse the resulting double spaces.
  const stripped = text
    .replace(/#(\w+)\s+/g, " ")
    .replace(/\s{2,}/g, " ");
  return { stripped, tags, priority, durationMinutes };
}

function SlashCommandInput({
  value,
  onChange,
  parsedTokens,
  onRemoveTag,
  onAddTag,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  parsedTokens: ParsedToken[];
  onRemoveTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  autoFocus?: boolean;
}) {
  const [addingTag, setAddingTag] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (addingTag) inputRef.current?.focus();
  }, [addingTag]);

  const submit = () => {
    const trimmed = draft.trim().replace(/^#/, "");
    if (trimmed) onAddTag(trimmed);
    setDraft("");
  };

  return (
    <div className="rounded-xl border-2 border-indigo-500 bg-white px-3 py-2 shadow-[0_0_0_4px_rgba(99,102,241,0.10)] dark:bg-neutral-950">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        placeholder="Task title or /command…"
        className="w-full bg-transparent text-[15px] font-medium text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
      />
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {parsedTokens.map((t, i) =>
          t.removable ? (
            <span
              key={`tag-${t.removable.tag}-${i}`}
              className={`group inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${t.toneClass}`}
            >
              {t.label}
              <button
                type="button"
                onClick={() => onRemoveTag(t.removable!.tag)}
                aria-label={`Remove ${t.label}`}
                className="-mr-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[12px] leading-none text-current opacity-60 transition-opacity hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
              >
                ×
              </button>
            </span>
          ) : (
            <span
              key={`${t.kind}-${i}`}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${t.toneClass}`}
            >
              {t.label}
            </span>
          )
        )}
        {addingTag ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            <span>#</span>
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^\w]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " " || e.key === ",") {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft("");
                  setAddingTag(false);
                } else if (e.key === "Backspace" && draft === "") {
                  e.preventDefault();
                  setAddingTag(false);
                }
              }}
              onBlur={() => {
                if (draft.trim()) submit();
                setAddingTag(false);
              }}
              placeholder="tag"
              aria-label="New tag"
              className="w-14 bg-transparent text-[11px] font-semibold outline-none placeholder:text-indigo-300 dark:placeholder:text-indigo-600"
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAddingTag(true)}
            className="inline-flex items-center rounded border border-dashed border-neutral-300 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-400 transition-colors hover:border-indigo-300 hover:text-indigo-500 dark:border-neutral-700 dark:hover:border-indigo-700"
          >
            + tag
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main modal ─────────────────────────────────────────────

interface TaskEditModalV2Props {
  task: Task;
  /** Projects the task can be assigned to. Powers the Project field. */
  projects?: Project[];
  open: boolean;
  onClose: () => void;
}

export function TaskEditModalV2({
  task,
  projects,
  open,
  onClose,
}: TaskEditModalV2Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClientSupabase(), []);
  const tasksApi = useMemo(
    () => new TasksApi(supabase, task.user_id),
    [supabase, task.user_id]
  );

  const {
    task: current,
    setField,
    undoAll,
    hasChanges,
    lastSavedAt,
    isSaving,
    lastError,
  } = useAutoSaveTask(task, tasksApi);

  const [titleDraft, setTitleDraft] = useState(current.title);
  useEffect(() => {
    setTitleDraft(current.title);
  }, [current.title]);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Projects created via the inline picker are merged locally so the Project
  // field can show them immediately; router.refresh on close reconciles.
  const [createdProjects, setCreatedProjects] = useState<Project[]>([]);
  const allProjects = useMemo(
    () => [...(projects ?? []), ...createdProjects],
    [projects, createdProjects]
  );

  const [busyness, setBusyness] = useState<DayBusyness[]>([]);
  useEffect(() => {
    if (!open) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sow = startOfWeek(today);
    const end = new Date(sow);
    end.setDate(end.getDate() + 13);
    const startStr = ymd(sow);
    const endStr = ymd(end);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/calendar/busyness?start=${startStr}&end=${endStr}`
        );
        if (!res.ok) return;
        const json = (await res.json()) as { days: DayBusyness[] };
        if (!cancelled) setBusyness(json.days ?? []);
      } catch {
        // Calendar fetch failed; keep busyness empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleClose = useCallback(() => {
    onClose();
    router.refresh();
  }, [onClose, router]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    const { error } = await tasksApi.delete(task.id);
    if (error) {
      console.error("Delete failed:", error);
      setDeleting(false);
      setConfirmingDelete(false);
      return;
    }
    handleClose();
  }, [tasksApi, task.id, handleClose]);

  // Reset the delete confirmation whenever the modal closes so it never
  // reappears pre-opened on the next launch.
  useEffect(() => {
    if (!open) {
      setConfirmingDelete(false);
      setDeleting(false);
    }
  }, [open]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // While the delete confirmation is up, its own handler owns the keyboard.
      if (confirmingDelete) return;
      if (e.key === "Escape") {
        handleClose();
        return;
      }
      // Skip shortcuts if focused in input/textarea
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key >= "1" && e.key <= "4") {
        setField(
          "priority",
          (`p${e.key}` as TaskPriority)
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose, setField, confirmingDelete]);

  // Esc cancels the delete confirmation (captured so it never reaches the
  // main modal's Esc-to-close handler).
  useEffect(() => {
    if (!confirmingDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) {
        e.preventDefault();
        e.stopPropagation();
        setConfirmingDelete(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmingDelete, deleting]);

  if (!open) return null;

  const onPickDate = (date: string) => {
    setField("when_date", date);
  };

  const tokens: ParsedToken[] = [];
  if (current.priority !== "p4") {
    const toneClass = {
      p1: "bg-red-100 text-red-700",
      p2: "bg-amber-100 text-amber-700",
      p3: "bg-indigo-100 text-indigo-700",
      p4: "bg-neutral-100 text-neutral-700",
    }[current.priority];
    tokens.push({
      kind: "priority",
      label: current.priority,
      toneClass,
    });
  }
  for (const tag of current.tags) {
    tokens.push({
      kind: "tag",
      label: `#${tag}`,
      toneClass:
        "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
      removable: { tag },
    });
  }
  if (current.duration_minutes) {
    tokens.push({
      kind: "estimate",
      label: `~${current.duration_minutes >= 60 ? `${Math.round(current.duration_minutes / 60)}h` : `${current.duration_minutes}m`}`,
      toneClass: "bg-green-100 text-green-700",
    });
  }

  const handleTitleChange = (v: string) => {
    const {
      stripped,
      tags: extracted,
      priority: extractedPriority,
      durationMinutes: extractedDuration,
    } = extractCompletedTags(v);
    const consumed =
      extracted.length > 0 ||
      extractedPriority !== undefined ||
      extractedDuration !== undefined;
    if (consumed) {
      if (extracted.length > 0) {
        const existing = new Set(current.tags);
        const fresh = extracted.filter((t) => !existing.has(t));
        if (fresh.length > 0) setField("tags", [...current.tags, ...fresh]);
      }
      if (extractedPriority) setField("priority", extractedPriority);
      if (extractedDuration) setField("duration_minutes", extractedDuration);
      setTitleDraft(stripped);
      setField("title", stripped);
    } else {
      setTitleDraft(v);
      setField("title", v);
    }
  };

  const handleRemoveTag = (tag: string) => {
    setField(
      "tags",
      current.tags.filter((t) => t !== tag)
    );
  };

  const handleAddTag = (tag: string) => {
    if (current.tags.includes(tag)) return;
    setField("tags", [...current.tags, tag]);
  };

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/30 p-3 backdrop-blur-sm sm:p-6"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[calc(100dvh-1.5rem)] w-[640px] max-w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(17,24,39,0.10),0_4px_12px_rgba(17,24,39,0.04)] sm:max-h-[90vh] dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-neutral-100 bg-white px-4 py-2.5 dark:border-neutral-900 dark:bg-neutral-950">
          <SaveStatusDot
            saving={isSaving}
            lastSavedAt={lastSavedAt}
            error={lastError}
          />
          <div className="flex items-center gap-3.5">
            {/* Always rendered so the top bar height is stable; toggled via
              opacity + pointer-events so the layout below it doesn't shift
              when the user starts editing. */}
            <button
              type="button"
              onClick={undoAll}
              tabIndex={hasChanges ? 0 : -1}
              aria-hidden={!hasChanges}
              className={`inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-500 transition-opacity hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900 ${
                hasChanges ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <span>↶</span>Undo all changes
            </button>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900"
            >
              ×
            </button>
          </div>
        </div>

        {/* Scrollable region — keeps the modal within the viewport on short
            screens (phones) instead of overflowing off the bottom. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Input */}
        <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-neutral-900 dark:bg-neutral-900/50">
          <SlashCommandInput
            value={titleDraft}
            onChange={handleTitleChange}
            parsedTokens={tokens}
            onRemoveTag={handleRemoveTag}
            onAddTag={handleAddTag}
            autoFocus
          />
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 px-5 py-4">
          {/* WHEN calendar */}
          <div>
            <div className="mb-2 flex items-baseline gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                When
              </span>
              <span className="text-sm font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                {current.when_date
                  ? new Date(current.when_date + "T00:00:00").toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })
                  : "Not scheduled"}
              </span>
              {current.when_date ? (
                <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                  · {formatRelative(current.when_date, ymd(new Date()))}
                </span>
              ) : null}
              {current.when_date && current.when_time ? (
                <span className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">
                  {formatWhenTime(current.when_time)}
                </span>
              ) : null}
            </div>
            <WhenCalendar
              whenDate={current.when_date}
              dueDate={current.due_date}
              busyness={busyness}
              onPickDate={onPickDate}
              onChangeDueDate={(v) => setField("due_date", v)}
            />
            {/* Time-of-day for the chosen do date — only meaningful with a
                when_date, so it appears once a day is picked. */}
            {current.when_date ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                  Time
                </span>
                <WhenTimeField
                  value={current.when_time}
                  onChange={(v) => setField("when_time", v)}
                />
              </div>
            ) : null}
          </div>

          {/* Inline meta */}
          <div className="flex flex-wrap items-center gap-4 border-y border-neutral-100 py-3 dark:border-neutral-900">
            <StatusField
              value={current.status}
              onChange={(s) => setField("status", s)}
            />
            <div className="border-l border-neutral-100 self-stretch dark:border-neutral-800" />
            <PriorityField
              value={current.priority}
              onChange={(p) => setField("priority", p)}
            />
            <div className="border-l border-neutral-100 self-stretch dark:border-neutral-800" />
            <EstimateField
              value={current.duration_minutes}
              onChange={(m) => setField("duration_minutes", m)}
            />
            <div className="border-l border-neutral-100 self-stretch dark:border-neutral-800" />
            <ProjectField
              projects={allProjects}
              value={current.project_id}
              userId={current.user_id}
              onChange={(id) => setField("project_id", id)}
              onCreated={(p) => setCreatedProjects((prev) => [...prev, p])}
            />
          </div>

          {/* Subtasks */}
          <SubtasksSection parentTask={current} tasksApi={tasksApi} />

          {/* Notes */}
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
              Notes
            </div>
            <textarea
              value={current.description ?? ""}
              onChange={(e) => setField("description", e.target.value || null)}
              placeholder="Tap to add notes…"
              rows={3}
              className="w-full rounded-lg border border-neutral-100 bg-neutral-50 px-3.5 py-2.5 text-[13px] text-neutral-700 outline-none transition-colors focus:border-indigo-300 focus:bg-white dark:border-neutral-900 dark:bg-neutral-900 dark:text-neutral-300 dark:focus:border-indigo-700 dark:focus:bg-neutral-950"
            />
          </div>
        </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-neutral-900 dark:bg-neutral-900/50">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              Delete
            </button>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
              <Kbd>1</Kbd>-<Kbd>4</Kbd>
              <span className="mx-1">priority</span>
              <Kbd>Esc</Kbd>
              <span className="mx-1">close</span>
            </div>
          </div>
          <DoneButton onClick={handleClose} />
        </div>
      </div>
    </div>
    {confirmingDelete ? (
      <ConfirmDeleteDialog
        title={current.title}
        deleting={deleting}
        onCancel={() => {
          if (!deleting) setConfirmingDelete(false);
        }}
        onConfirm={() => {
          if (!deleting) void handleDelete();
        }}
      />
    ) : null}
    </>
  );
}

function ConfirmDeleteDialog({
  title,
  deleting,
  onCancel,
  onConfirm,
}: {
  title: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const trimmed = title.trim();
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        className="w-[min(25rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(17,24,39,0.18),0_4px_12px_rgba(17,24,39,0.08)] dark:bg-neutral-950 dark:ring-1 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pb-5 pt-6">
          <h2
            id="confirm-delete-title"
            className="text-[17px] font-bold tracking-tight text-neutral-900 dark:text-neutral-50"
          >
            Delete task?
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            The{" "}
            <span className="font-semibold text-neutral-700 dark:text-neutral-200">
              {trimmed ? trimmed : "untitled"}
            </span>{" "}
            task will be permanently deleted.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3.5 dark:border-neutral-900 dark:bg-neutral-900/50">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-neutral-600 transition-colors hover:bg-neutral-200/70 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-lg bg-red-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-default disabled:opacity-60 dark:hover:bg-red-500"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded border border-neutral-200 bg-white px-1.5 py-[1px] text-[10px] font-mono text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      {children}
    </span>
  );
}
