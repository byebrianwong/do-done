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
  datesBetweenLocalISO,
  formatFullDate,
  formatRelativeDay,
  formatScheduleHint,
  formatTimeOfDay,
  type Project,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@do-done/shared";
import {
  useAutoSaveTask,
  TasksApi,
  type DayBusyness,
  type SaveStatus,
} from "@do-done/api-client";
import { createClientSupabase } from "@/lib/supabase/client";
import { isCopyLinkShortcut } from "@/lib/task-link";
import { useCopyTaskLink } from "@/lib/use-copy-task-link";
import { ProjectPickerPopover } from "./project-picker";
import { LinkifiedText } from "./linkified-text";

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

// ─── Sub-components ────────────────────────────────────────

/**
 * Copy and tone per save phase. `pending` and `saving` deliberately read the
 * same: the user doesn't care whether the request has left yet, only that the
 * edit is in hand and not on the server. Rendering them identically also means
 * the debounce elapsing doesn't cause a second, meaningless flicker.
 */
const SAVE_STATUS_COPY: Record<
  SaveStatus,
  { label: string; dot: string; text: string }
> = {
  idle: { label: "Auto-saves", dot: "bg-neutral-300", text: "text-neutral-500" },
  pending: { label: "Saving…", dot: "bg-amber-500", text: "text-amber-600" },
  saving: { label: "Saving…", dot: "bg-amber-500", text: "text-amber-600" },
  saved: { label: "Saved", dot: "bg-green-500", text: "text-green-600" },
  error: { label: "Save failed", dot: "bg-red-500", text: "text-red-600" },
};

function SaveStatusDot({
  status,
  error,
}: {
  status: SaveStatus;
  error: Error | null;
}) {
  const { label, dot, text } = SAVE_STATUS_COPY[status];
  // Pulse only while there's unsaved work — movement is what gets noticed at
  // the edge of vision, and it stops the moment the edit is safe.
  const inFlight = status === "pending" || status === "saving";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors ${text}`}
      title={status === "error" && error ? error.message : "Changes auto-save"}
      aria-live="polite"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${dot} ${inFlight ? "animate-pulse" : ""}`}
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
  dividerLeft,
}: {
  value: TaskStatus;
  onChange: (s: TaskStatus) => void;
  dividerLeft?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));
  const cfg = STATUS_CONFIG[value];

  return (
    <div
      ref={ref}
      className={`relative flex flex-col items-center gap-2 px-2 py-3 ${
        dividerLeft ? "border-l border-neutral-100 dark:border-neutral-800" : ""
      }`}
    >
      <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
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
  dividerLeft,
}: {
  projects: Project[];
  value: string | null;
  userId: string;
  onChange: (projectId: string | null) => void;
  onCreated: (project: Project) => void;
  dividerLeft?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));
  const selected = value ? projects.find((p) => p.id === value) ?? null : null;

  return (
    <div
      ref={ref}
      className={`relative flex min-w-0 flex-col items-center gap-2 px-2 py-3 ${
        dividerLeft ? "border-l border-neutral-100 dark:border-neutral-800" : ""
      }`}
    >
      <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
        Project
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        {selected ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: selected.color }}
          />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-neutral-400" />
        )}
        <span className={`truncate ${selected ? "" : "text-neutral-400"}`}>
          {selected
            ? `${selected.icon ? `${selected.icon} ` : ""}${selected.name}`
            : "No project"}
        </span>
        <span className="shrink-0 text-neutral-400">▾</span>
      </button>
      {open ? (
        <ProjectPickerPopover
          projects={projects}
          selectedId={value}
          userId={userId}
          onSelect={onChange}
          onCreated={onCreated}
          onClose={() => setOpen(false)}
          align="right"
        />
      ) : null}
    </div>
  );
}

function PriorityField({
  value,
  onChange,
  dividerLeft,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
  dividerLeft?: boolean;
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
    <div
      ref={ref}
      className={`relative flex flex-col items-center gap-2 px-2 py-3 ${
        dividerLeft ? "border-l border-neutral-100 dark:border-neutral-800" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="rounded text-[11px] font-medium text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        Priority
      </button>
      <div className="flex flex-col items-center gap-1.5">
        <PrioritySignal
          value={value}
          hovered={hovered}
          onChange={handleChange}
          onHover={setHovered}
        />
        {/* Single value slot — hover preview replaces the committed label
            (rather than appending an arrow) so the cell width can't grow and
            jostle neighbouring fields. */}
        <span className="min-w-[5ch] text-center text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
          {previewLabel ?? PRIORITY_CONFIG[value].label}
        </span>
      </div>
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
  dividerLeft,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
  dividerLeft?: boolean;
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
    <div
      ref={ref}
      className={`relative flex flex-col items-center gap-2 px-2 py-3 ${
        dividerLeft ? "border-l border-neutral-100 dark:border-neutral-800" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="rounded text-[11px] font-medium text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        Estimate
      </button>
      <div className="flex flex-col items-center gap-1.5">
        <EstimateEqualizer
          value={value}
          hovered={hovered}
          onChange={handleChange}
          onHover={setHovered}
        />
        {/* Single value slot — hover preview replaces the committed value so
            the cell width stays stable and neighbours don't shift. */}
        <span className="min-w-[5ch] text-center text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">
          {previewLabel ?? (value ? formatEstimateShort(value) : "—")}
        </span>
      </div>
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
  /** Optional muted secondary label, right-aligned (e.g. the resolved date
   *  "Sun Jul 5" next to a friendly shorthand like "Next week"). */
  hint?: string;
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

  // Date pickers carry a resolved-date hint per row; give them extra room so the
  // label and the hint sit on one line instead of wrapping.
  const hasHint = options.some((o) => o.hint);

  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className={`absolute left-0 top-full z-20 mt-2 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_12px_24px_rgba(17,24,39,0.10),0_2px_6px_rgba(17,24,39,0.05)] dark:border-neutral-800 dark:bg-neutral-950 ${
        hasHint ? "min-w-[240px]" : "min-w-[180px]"
      }`}
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
          {opt.hint ? (
            <span className="ml-auto text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
              {opt.hint}
            </span>
          ) : null}
          {opt.selected ? (
            <span
              aria-hidden
              className={`${opt.hint ? "ml-1.5" : "ml-auto"} text-[11px] font-semibold text-indigo-600 dark:text-indigo-400`}
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

// Dismisses the editor. Deliberately quiet: everything auto-saves, so there is
// nothing to commit here, and this used to be a primary button wearing a green
// ✓ labelled "Done" — which read as "complete the task" rather than "close the
// editor". The ✓ now belongs to `CompleteToggle` alone.
//
// It carries no save-state caption either. That caption was a second claim
// about the user's data in a bigger font than the top-bar indicator, so it had
// to be kept honest in two places; with it gone, `SaveStatusDot` is the single
// place that speaks for save state.
function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Close (all changes auto-saved)"
      className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-[13px] font-semibold text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
    >
      Close
      <span className="rounded bg-neutral-100 px-1.5 text-[10px] font-mono text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        Esc
      </span>
    </button>
  );
}

// The completion circle from a task row, brought into the editor so completing
// the open task is one click here too — it was previously reachable only as one
// of seven entries in the Status dropdown. Same geometry and status colouring as
// `task-item.tsx`, so the control is the one the user already knows from the
// list. Writes through `setField`, so the Status field stays in sync.
function CompleteToggle({
  status,
  onChange,
}: {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
}) {
  const completed = status === "done" || status === "cancelled";
  // STATUS_CONFIG[status] can be undefined for an unmigrated DB still serving
  // legacy values — guard before reading .color, as the row does.
  const statusColor = STATUS_CONFIG[status]?.color ?? "#94a3b8";
  const label = completed ? "Mark incomplete" : "Mark complete";
  return (
    <button
      type="button"
      onClick={() => onChange(completed ? "not_started" : "done")}
      aria-label={label}
      aria-pressed={completed}
      title={label}
      className="flex h-5 shrink-0 items-center justify-center"
    >
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors"
        style={{
          borderColor: completed ? "#d4d4d4" : statusColor,
          backgroundColor: completed ? "#d4d4d4" : "transparent",
        }}
      >
        {completed ? (
          <svg
            className="h-3 w-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        ) : null}
      </span>
    </button>
  );
}

// Overflow menu in the top bar. Holds the actions that shouldn't sit in the
// chrome competing with the task's own controls — Delete was previously loose
// in the footer, a red button one slip away from the dismiss control.
// `open` is owned by the modal body so its Esc handler can close this first
// rather than dismissing the whole editor.
function TaskMenu({
  open,
  onOpenChange,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useClickOutside(ref, close);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label="Task menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900"
      >
        <svg
          aria-hidden
          className="h-3.5 w-3.5"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
        >
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Task actions"
          className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenChange(false);
              onDelete();
            }}
            className="flex w-full items-center px-3 py-1.5 text-left text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            Delete task
          </button>
        </div>
      ) : null}
    </div>
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

// ─── Today → task-date span ────────────────────────────────

/** One week row's window onto the span, in the grid's coordinate space. */
type WaveRun = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Distance from the span's start to this run's start, along the span. */
  offset: number;
};

type SpanWave = {
  runs: WaveRun[];
  /** Total length of the span across every row, end to end. */
  totalWidth: number;
  bandWidth: number;
  durationMs: number;
};

/**
 * Screen geometry for the wave that travels from "today" to the selected task
 * date, measured from the DOM inside `gridRef`. The cells are fluid-width
 * (`grid-cols-7` in a modal that resizes with the viewport), so their rendered
 * rects are the only reliable source — grid maths would drift.
 *
 * A span that wraps to the next week row is returned as several runs. Laid end
 * to end they form one continuous space the band crosses exactly once, so the
 * wave reads as a single sweep rather than restarting on each row.
 *
 * The region stops at the target cell's left edge: the selected day is a solid
 * indigo fill that the band could not show through anyway, so the wave arrives
 * at it rather than under it.
 */
function useSpanWave(
  gridRef: React.RefObject<HTMLDivElement | null>,
  fromDate: string,
  toDate: string | null,
  /** Dates strictly between the two — recomputed by the caller anyway. */
  between: string[]
): SpanWave | null {
  const [wave, setWave] = useState<SpanWave | null>(null);
  // Identity of the span, so the effect doesn't re-run on every array rebuild.
  const betweenKey = between.join(",");

  useEffect(() => {
    const el = gridRef.current;
    // Adjacent days (nothing in between) have no room for a wave, and the two
    // cell markers already sit side by side.
    if (!el || !toDate || toDate <= fromDate || betweenKey === "") {
      setWave(null);
      return;
    }
    const measure = () => {
      const base = el.getBoundingClientRect();
      const dates = [fromDate, ...betweenKey.split(",")];
      const rects: DOMRect[] = [];
      for (const d of dates) {
        const cell = el.querySelector<HTMLElement>(`[data-date="${d}"]`);
        // A span running off the end of this grid still waves over the part
        // that is visible, so a missing cell just ends the run.
        if (!cell) break;
        rects.push(cell.getBoundingClientRect());
      }
      if (rects.length === 0) {
        setWave(null);
        return;
      }

      // Group consecutive cells into per-row runs.
      const runs: WaveRun[] = [];
      let offset = 0;
      let i = 0;
      while (i < rects.length) {
        const first = rects[i];
        let j = i;
        while (
          j + 1 < rects.length &&
          Math.abs(rects[j + 1].top - first.top) <= 2
        ) {
          j++;
        }
        const last = rects[j];
        const width = last.right - first.left;
        runs.push({
          left: first.left - base.left,
          top: first.top - base.top,
          width,
          height: first.height,
          offset,
        });
        offset += width;
        i = j + 1;
      }

      const totalWidth = offset;
      if (totalWidth < 24) {
        setWave(null);
        return;
      }
      // A band roughly a day and a half wide reads as a soft swell rather than
      // a lit-up cell; clamped so very long spans don't wash the whole grid.
      const dayWidth = totalWidth / rects.length;
      const bandWidth = Math.min(Math.max(dayWidth * 1.6, 48), 190);
      // Constant travel speed, so a longer span takes proportionally longer
      // instead of the band accelerating across it.
      const durationMs = Math.min(
        Math.max((totalWidth + bandWidth) * 7.5, 2200),
        7000
      );
      setWave({ runs, totalWidth, bandWidth, durationMs });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gridRef, fromDate, toDate, betweenKey]);

  return wave;
}

/**
 * The wave overlay. Rendered as the grid's first child so the day cells, which
 * come later in DOM order and are all positioned, paint on top of it — the band
 * glows through their translucent backgrounds instead of washing over the day
 * numbers.
 */
function SpanWaveOverlay({ wave }: { wave: SpanWave }) {
  const { runs, totalWidth, bandWidth, durationMs } = wave;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {runs.map((run) => (
        <div
          key={`${run.top}-${run.left}`}
          className="absolute overflow-hidden rounded-lg"
          style={{
            left: run.left,
            top: run.top,
            width: run.width,
            height: run.height,
          }}
        >
          {/* Shifts this row's window into the span's shared coordinate space. */}
          <div
            className="absolute inset-y-0"
            style={{ left: -run.offset, width: totalWidth }}
          >
            <div
              className="dd-wave-band"
              style={
                {
                  "--dd-wave-width": `${bandWidth}px`,
                  "--dd-wave-travel": `${totalWidth + bandWidth}px`,
                  "--dd-wave-duration": `${durationMs}ms`,
                } as React.CSSProperties
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Month grid for the "See more dates" scroll view ──

function MonthGrid({
  year,
  month,
  todayStr,
  selectedDate,
  spanDates,
  spanList,
  busyByDate,
  onPick,
}: {
  year: number;
  month: number; // 0-indexed
  todayStr: string;
  selectedDate: string | null;
  /** Dates strictly between today and the selected date — the tinted runway. */
  spanDates: Set<string>;
  /** The same dates in order, for the wave to travel along. */
  spanList: string[];
  busyByDate: Map<string, DayBusyness>;
  onPick: (date: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const wave = useSpanWave(gridRef, todayStr, selectedDate, spanList);
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
      {/*
        The wave works here where the old arc couldn't: it sits behind these
        28px cells and glows through them, rather than crossing their centred
        digits like a strikethrough.
      */}
      <div ref={gridRef} className="relative grid grid-cols-7 gap-0.5">
        {wave ? <SpanWaveOverlay wave={wave} /> : null}
        {cells.map((c, i) => {
          if (!c.date) {
            return <div key={`pad-${i}`} className="h-7" />;
          }
          const date = c.date;
          const isPast = date < todayStr;
          const isToday = date === todayStr;
          const isActive = selectedDate === date;
          const inSpan = spanDates.has(date);
          const day = busyByDate.get(date);
          const hasBusy = (day?.items?.length ?? 0) > 0;
          return (
            <button
              type="button"
              key={date}
              data-date={date}
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
                      ? "bg-indigo-500/10 ring-1 ring-inset ring-indigo-400 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                      : inSpan
                        ? "bg-indigo-500/[0.13] text-neutral-700 hover:bg-white hover:ring-1 hover:ring-neutral-200 dark:bg-indigo-500/20 dark:text-neutral-300 dark:hover:bg-neutral-800"
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

function ScheduleCalendar({
  scheduledDate,
  deadlineDate,
  busyness,
  onPickDate,
  onChangeDeadlineDate,
}: {
  scheduledDate: string | null;
  deadlineDate: string | null;
  busyness: DayBusyness[];
  onPickDate: (date: string) => void;
  onChangeDeadlineDate: (v: string | null) => void;
}) {
  // Near the weekend (Thu–Sat), default to the two-week view so the next
  // week is visible at a glance; otherwise start collapsed to one week.
  const [expanded, setExpanded] = useState<CalendarExpansion>(() => {
    const day = new Date().getDay(); // 0=Sun … 4=Thu, 5=Fri, 6=Sat
    return day >= 4 && day <= 6 ? "two-weeks" : "collapsed";
  });
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
  // bucket, so it survives as a real scheduled_date.
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

  // The "runway": the days between now and when the task is scheduled. Only
  // forward spans have one — a task dated today or overdue has no distance to
  // show, and its own cell already carries the marker.
  const spanList = useMemo(() => {
    if (!scheduledDate || scheduledDate <= todayStr) return [];
    return datesBetweenLocalISO(todayStr, scheduledDate);
  }, [todayStr, scheduledDate]);
  const spanDates = useMemo(() => new Set(spanList), [spanList]);

  // The week strip's wave. It covers whatever part of the span is on this grid,
  // wrapping onto the second row as one continuous sweep. A target beyond the
  // visible weeks just means the wave runs to the edge, and the header above
  // still spells it out ("Thursday, January 22nd · in 1 week").
  const weekGridRef = useRef<HTMLDivElement | null>(null);
  const weekWave = useSpanWave(weekGridRef, todayStr, scheduledDate, spanList);

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
      <div ref={weekGridRef} className="relative grid grid-cols-7 gap-1">
        {weekWave ? <SpanWaveOverlay wave={weekWave} /> : null}
        {cells.map((c) => {
          const isWeekend = c.weekday === 0 || c.weekday === 6;
          const isPast = c.date < todayStr;
          const isToday = c.date === todayStr;
          const isActive = scheduledDate === c.date;
          const inSpan = spanDates.has(c.date);
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
              data-date={c.date}
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
                      ? // Today used to read as a plain white cell, quieter than
                        // every neighbour. It anchors the span now, so it gets
                        // its own outline — one step below the selected fill.
                        "border-indigo-400 bg-indigo-500/[0.10] dark:border-indigo-500/70 dark:bg-indigo-500/20"
                      : inSpan
                        ? // Weekends already carry a 0.035 indigo wash, so the
                          // runway needs real separation from it to read as a
                          // span rather than as another weekend.
                          "border-transparent bg-indigo-500/[0.13] hover:border-neutral-200 hover:bg-white dark:bg-indigo-500/20 dark:hover:bg-neutral-900"
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

      {/* Action row: progressive expand + next week + deadline */}
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
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            scheduledDate === nextWeekStr
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              : "bg-neutral-50 text-neutral-700 hover:bg-white hover:ring-1 hover:ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
        >
          Next week
          <span
            className={
              scheduledDate === nextWeekStr
                ? "text-indigo-500/80 dark:text-indigo-300/70"
                : "text-neutral-400 dark:text-neutral-500"
            }
          >
            {formatScheduleHint(nextWeekStr)}
          </span>
        </button>
        <DeadlineDateField
          value={deadlineDate}
          scheduledDate={scheduledDate}
          onChange={onChangeDeadlineDate}
        />
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
              selectedDate={scheduledDate}
              spanDates={spanDates}
              spanList={spanList}
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
  onOpen,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  /** Open this subtask in the modal (drill down into its own editor). */
  onOpen: () => void;
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
      {/* The title opens the subtask in its own modal view. Clickable but not
          a <button>: it linkifies its URLs, and an <a> inside a <button> is
          invalid. Keyboard access to "open" is the chevron below, which is a
          real button — so this stays out of the tab order rather than nesting
          a link inside something focusable. It's still its own element (not
          the row) so it doesn't swallow clicks meant for the toggle/delete. */}
      <div
        onClick={onOpen}
        title={`Open “${task.title}”`}
        className={`min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] transition-colors hover:text-indigo-600 dark:hover:text-indigo-400 ${
          done
            ? "text-neutral-400 line-through dark:text-neutral-600"
            : "text-neutral-800 dark:text-neutral-200"
        }`}
      >
        <LinkifiedText text={task.title} />
      </div>
      {/* Open affordance — a subtle chevron that appears on hover, echoing the
          "row is navigable" cue. It also carries this row's keyboard access to
          "open", so focus has to reveal it too, not just hover. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${task.title}`}
        className="inline-flex h-5 w-5 items-center justify-center rounded-md text-neutral-300 opacity-0 transition-all hover:bg-neutral-100 hover:text-neutral-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-neutral-600 dark:hover:bg-neutral-800"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
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
  onOpenSubtask,
}: {
  parentTask: Task;
  tasksApi: TasksApi;
  /** Drill the modal into a subtask's own editor. */
  onOpenSubtask: (task: Task) => void;
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
            onOpen={() => onOpenSubtask(st)}
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

// ─── Notes field ────────────────────────────────────────────

/**
 * Notes, with URLs rendered as clickable links.
 *
 * A `<textarea>` can only ever hold dead text, so notes — the field a URL is
 * most likely to be pasted into — swap between a linkified read view and the
 * editor: click the notes to edit, blur to go back to links. Empty notes go
 * straight to the textarea so the "add notes" affordance still takes one click.
 */
function NotesField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const text = value ?? "";

  // One box shared by both states — same padding, border and min-height — so
  // swapping between them doesn't nudge the layout. The min-height carries the
  // sizing rather than `rows`, which measures differently from a block element.
  const box =
    "w-full min-h-[5.25rem] rounded-lg border px-3.5 py-2.5 text-[13px] text-neutral-700 border-neutral-100 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-900 dark:text-neutral-300";

  if (editing || text.length === 0) {
    return (
      <textarea
        value={text}
        autoFocus={editing}
        onChange={(e) => onChange(e.target.value || null)}
        onBlur={() => setEditing(false)}
        placeholder="Tap to add notes…"
        className={`${box} block outline-none transition-colors focus:border-indigo-300 focus:bg-white dark:focus:border-indigo-700 dark:focus:bg-neutral-950`}
      />
    );
  }

  return (
    <div
      // Not a <button>: the read view contains anchors, and an <a> inside a
      // <button> is invalid. A click that lands on a link follows it (the
      // anchor stops propagation) — anywhere else opens the editor.
      role="textbox"
      tabIndex={0}
      aria-label="Notes"
      onClick={() => setEditing(true)}
      // Only a focus on the box itself (tabbing in) opens the editor. React's
      // onFocus is focusin, which bubbles — without this guard, clicking a
      // link focuses the anchor, unmounts the read view mid-click and the
      // navigation never happens.
      onFocus={(e) => {
        if (e.target === e.currentTarget) setEditing(true);
      }}
      className={`${box} cursor-text whitespace-pre-wrap break-words outline-none`}
    >
      <LinkifiedText text={text} />
    </div>
  );
}

// ─── Deadline field ─────────────────────────────────────────

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

function formatDeadlineShort(value: string): string {
  const d = new Date(value + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Quick-pick deadlines for the deadline popover. `scheduledDate` (the task's "do
// date") is threaded in so "Same as task date" can mirror it. Pure given a
// reference `today`, so the labels track the real calendar.
function deadlineQuickOptions(
  today: Date,
  scheduledDate: string | null
): { key: string; label: string; date: string }[] {
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  // "This weekend" = the upcoming Sunday (the day that closes the current
  // Sunday-start week); never today, so a Sunday rolls to the next one.
  const sunday = new Date(today);
  sunday.setDate(sunday.getDate() + ((7 - today.getDay()) % 7 || 7));
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const opts: { key: string; label: string; date: string }[] = [];
  if (scheduledDate) opts.push({ key: "task", label: "Same as task date", date: scheduledDate });
  opts.push({ key: "tomorrow", label: "Tomorrow", date: ymd(tomorrow) });
  opts.push({ key: "weekend", label: "This weekend", date: ymd(sunday) });
  opts.push({ key: "nextweek", label: "Next week", date: ymd(nextWeek) });
  return opts;
}

function DeadlineDateField({
  value,
  scheduledDate,
  onChange,
}: {
  value: string | null;
  scheduledDate: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));

  // Computed each render so "Tomorrow"/"This weekend"/"Next week" stay anchored
  // to the real today (cheap — four Date objects).
  const quickOptions = deadlineQuickOptions(new Date(), scheduledDate);

  const active = !!value;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={value ? `Deadline ${formatDeadlineShort(value)}` : "Set deadline"}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
          active
            ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900"
            : "bg-neutral-50 text-neutral-500 hover:bg-white hover:ring-1 hover:ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
      >
        <CheckeredFlagIcon className="h-3.5 w-3.5" />
        {active ? <span>Deadline {formatDeadlineShort(value!)}</span> : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Deadline"
          className="absolute right-0 top-full z-20 mt-2 w-60 rounded-lg border border-neutral-200 bg-white p-3 shadow-[0_12px_24px_rgba(17,24,39,0.10),0_2px_6px_rgba(17,24,39,0.05)] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            <CheckeredFlagIcon className="h-3 w-3" /> Deadline
          </div>
          {/* Common deadlines — one tap, no scrubbing through a date input. */}
          <div className="flex flex-col gap-0.5">
            {quickOptions.map((opt) => {
              const selected = value === opt.date;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    onChange(opt.date);
                    setOpen(false);
                  }}
                  className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    selected
                      ? "bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/70 dark:text-amber-200 dark:ring-amber-900"
                      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  }`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`text-[11px] tabular-nums ${
                      selected
                        ? "text-amber-600 dark:text-amber-300"
                        : "text-neutral-400"
                    }`}
                  >
                    {formatDeadlineShort(opt.date)}
                  </span>
                </button>
              );
            })}
          </div>
          {/* Escape hatch for any other date. */}
          <div className="mt-2.5 mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-300 dark:text-neutral-600">
            <span className="h-px flex-1 bg-neutral-100 dark:bg-neutral-800" />
            or a specific date
            <span className="h-px flex-1 bg-neutral-100 dark:bg-neutral-800" />
          </div>
          <input
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
              aria-label="Clear deadline"
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

// Every half hour across the day, as "HH:MM". Built once — the time scroller
// renders these as quick-pick rows.
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

// Round wall-clock `now` to the nearest hour, as an "HH:00" slot. Anchors the
// scroller near "now" when it opens (2:03pm → "14:00", 2:45pm → "15:00").
function nearestHourSlot(now: Date): string {
  const h = (now.getHours() + Math.round(now.getMinutes() / 60)) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

// Optional time-of-day for the scheduled_date "do date". Indigo (the "when" accent),
// distinct from the amber/checkered-flag deadline styling. Only meaningful when
// a scheduled_date is set, so the caller gates rendering on that. Picking is a quick
// scroll through half-hour slots (auto-centered on the hour nearest now); the
// precise native input is tucked behind "Specific time" for the rare case.
// Exported so the task row's inline reschedule popover reuses the exact same
// picker instead of a bare native time input.
export function ScheduledTimeField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showSpecific, setShowSpecific] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  useClickOutside(ref, () => setOpen(false));

  // A value set via the precise input can land off the half-hour grid; in that
  // case anchor the scroller on "now" and force the precise input open (the
  // grid can't represent that value).
  const onGrid = value != null && TIME_SLOTS.includes(value);
  const offGrid = value != null && !onGrid;
  const anchorSlot = onGrid ? value! : nearestHourSlot(new Date());
  const specificVisible = showSpecific || offGrid;

  useEffect(() => {
    if (!open) return;
    // Center the anchor row without scrolling the whole modal.
    const list = listRef.current;
    const anchor = anchorRef.current;
    if (list && anchor) {
      list.scrollTop =
        anchor.offsetTop - list.clientHeight / 2 + anchor.clientHeight / 2;
    }
  }, [open, anchorSlot]);

  const active = !!value;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          // Collapse the precise input each time we (re)open.
          if (!open) setShowSpecific(false);
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={value ? `At ${formatTimeOfDay(value)}` : "Set a time"}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
          active
            ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-900"
            : "bg-neutral-50 text-neutral-500 hover:bg-white hover:ring-1 hover:ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
      >
        <ClockIcon className="h-3.5 w-3.5" />
        <span>{active ? formatTimeOfDay(value!) : "Add time"}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Do time"
          className="absolute left-0 top-full z-20 mt-2 w-44 rounded-lg border border-neutral-200 bg-white p-2 shadow-[0_12px_24px_rgba(17,24,39,0.10),0_2px_6px_rgba(17,24,39,0.05)] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            <ClockIcon className="h-3 w-3" /> Time
          </div>
          <div
            ref={listRef}
            className="max-h-[196px] overflow-y-auto overscroll-contain rounded-md [scrollbar-color:rgb(212_212_212)_transparent] [scrollbar-width:thin] dark:[scrollbar-color:rgb(64_64_64)_transparent]"
          >
            {TIME_SLOTS.map((slot) => {
              const selected = value === slot;
              const isAnchor = slot === anchorSlot;
              return (
                <button
                  key={slot}
                  ref={isAnchor ? anchorRef : undefined}
                  type="button"
                  onClick={() => {
                    onChange(slot);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors ${
                    selected
                      ? "bg-indigo-500 text-white"
                      : isAnchor
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                        : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  }`}
                >
                  <span className="tabular-nums">{formatTimeOfDay(slot)}</span>
                  {isAnchor && !selected ? (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-400">
                      now
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setShowSpecific((s) => !s)}
            aria-expanded={specificVisible}
            className="mt-1.5 w-full rounded-md px-2 py-1 text-left text-[11px] font-semibold text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
          >
            {specificVisible ? "▾ Specific time" : "▸ Specific time"}
          </button>
          {specificVisible ? (
            <input
              type="time"
              value={value ?? ""}
              onChange={(e) => onChange(e.target.value || null)}
              className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-[13px] text-neutral-800 outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
            />
          ) : null}
          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              aria-label="Clear time"
              className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
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
  selectOnFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  parsedTokens: ParsedToken[];
  onRemoveTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  autoFocus?: boolean;
  /** Select the whole title on mount (draft "New task" → typing replaces it). */
  selectOnFocus?: boolean;
}) {
  const [addingTag, setAddingTag] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (addingTag) inputRef.current?.focus();
  }, [addingTag]);

  useEffect(() => {
    if (selectOnFocus) titleRef.current?.select();
  }, [selectOnFocus]);

  const submit = () => {
    const trimmed = draft.trim().replace(/^#/, "");
    if (trimmed) onAddTag(trimmed);
    setDraft("");
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 transition focus-within:border-indigo-400 focus-within:shadow-[0_0_0_2px_rgba(99,102,241,0.18)] dark:border-neutral-800 dark:bg-neutral-950 dark:focus-within:border-indigo-500">
      {/* Title and the add-tag affordance share one row. The add-tag control
          sits inline at the end of the title row, so a task with no tags no
          longer renders an almost-empty second row under the input. */}
      <div className="flex items-center gap-2">
        <input
          ref={titleRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          placeholder="Task title or /command…"
          className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
        />
        {addingTag ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
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
            className="inline-flex shrink-0 items-center rounded border border-dashed border-neutral-300 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-400 transition-colors hover:border-indigo-300 hover:text-indigo-500 dark:border-neutral-700 dark:hover:border-indigo-700"
          >
            + tag
          </button>
        )}
      </div>
      {/* Applied chips (priority / tags / estimate) render only when present —
          no empty chip row on a fresh task. */}
      {parsedTokens.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
        </div>
      ) : null}
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
  /**
   * The task was created as a throwaway draft (e.g. "expand" from an empty
   * quick-add). Selects the title on open so it's instantly replaceable, and
   * deletes the task on close if the user never touched it.
   */
  draft?: boolean;
}

/**
 * Public modal. Thin shell that owns *which* task is on screen: the editor can
 * drill from the opened task into a subtask, or climb back to a parent, without
 * ever leaving the modal. The heavy body is keyed on the active task's id so
 * `useAutoSaveTask` re-snapshots cleanly on each hop (a still-pending save on
 * the task we're leaving flushes on unmount).
 */
export function TaskEditModalV2(props: TaskEditModalV2Props) {
  const { task, open } = props;
  const [activeTask, setActiveTask] = useState<Task>(task);

  // Re-root on open, or when the owner swaps in a different task — done in the
  // render phase (not an effect) so an in-place re-render never clobbers a
  // drill-down. `marker` is the (id, open) pair we last rooted on.
  const marker = `${task.id}:${open}`;
  const [rootedMarker, setRootedMarker] = useState(marker);
  if (marker !== rootedMarker) {
    setRootedMarker(marker);
    // Closing shouldn't disturb activeTask (the body is hidden); only re-root
    // while open, on the (possibly new) task the owner handed us.
    if (open) setActiveTask(task);
  }

  return (
    <TaskEditModalBody
      key={activeTask.id}
      {...props}
      task={activeTask}
      // Only the originally-opened task can be a throwaway draft; a task we
      // drilled into is a real, saved row.
      draft={props.draft && activeTask.id === task.id}
      onNavigateTask={setActiveTask}
    />
  );
}

function TaskEditModalBody({
  task,
  projects,
  open,
  onClose,
  draft,
  onNavigateTask,
}: TaskEditModalV2Props & {
  /** Drill the modal to another task (a subtask, or this task's parent). */
  onNavigateTask: (task: Task) => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClientSupabase(), []);
  const tasksApi = useMemo(
    () => new TasksApi(supabase, task.user_id),
    [supabase, task.user_id]
  );

  // Parent task, resolved when the active task is a subtask, so the top bar can
  // offer a "← parent" way back. Fetched once per task; the button also serves
  // as the navigation target so the click needs no extra round-trip.
  // Starts null every mount; the body is keyed on the task id, so navigating to
  // another task remounts this fresh rather than needing a reset here.
  const [parentTask, setParentTask] = useState<Task | null>(null);
  useEffect(() => {
    const parentId = task.parent_task_id;
    if (!parentId) return;
    let cancelled = false;
    (async () => {
      const { data } = await tasksApi.getById(parentId);
      if (!cancelled) setParentTask(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [task.parent_task_id, tasksApi]);

  const {
    task: current,
    setField,
    undoAll,
    hasChanges,
    status: saveStatus,
    lastError,
  } = useAutoSaveTask(task, tasksApi, {
    // Re-run the server components so the list views pick up the row that was
    // just saved. Fires after the PATCH commits, so it never re-reads the stale
    // row the way a close-time refresh did.
    onSaved: () => router.refresh(),
  });

  const [titleDraft, setTitleDraft] = useState(current.title);
  useEffect(() => {
    setTitleDraft(current.title);
  }, [current.title]);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  // Shares whichever task is on screen — the one drilled into, not the one the
  // editor was opened on.
  const copyLinkFor = useCopyTaskLink();
  const copyLink = useCallback(
    () => copyLinkFor(task.id),
    [copyLinkFor, task.id]
  );

  const handleClose = useCallback(() => {
    // A throwaway draft the user opened but never edited: drop it instead of
    // leaving an orphaned "New task" behind.
    if (draft && !hasChanges) {
      void tasksApi.delete(task.id);
    }
    onClose();
    router.refresh();
  }, [draft, hasChanges, tasksApi, task.id, onClose, router]);

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

  // Reset the delete confirmation and overflow menu whenever the modal closes
  // so neither reappears pre-opened on the next launch.
  useEffect(() => {
    if (!open) {
      setConfirmingDelete(false);
      setDeleting(false);
      setMenuOpen(false);
    }
  }, [open]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // While the delete confirmation is up, its own handler owns the keyboard.
      if (confirmingDelete) return;
      if (e.key === "Escape") {
        // The overflow menu owns Esc while it's open — back out of the menu
        // rather than dismissing the whole editor under it.
        if (menuOpen) {
          setMenuOpen(false);
          return;
        }
        handleClose();
        return;
      }
      // Deliberately ahead of the input/textarea bail below: the title field
      // holds focus the moment the editor opens, so a copy-link shortcut that
      // only worked outside it would never fire in practice.
      if (isCopyLinkShortcut(e)) {
        e.preventDefault();
        void copyLink();
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
  }, [open, handleClose, setField, confirmingDelete, menuOpen, copyLink]);

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
    setField("scheduled_date", date);
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
    {/* data-no-dnd: this overlay renders inside a draggable task row's React
        subtree, so pointer gestures here (e.g. selecting the title text) would
        otherwise bubble to the row's drag sensor and yank the modal away. The
        custom sensors in lib/dnd-sensors skip activation inside this marker. */}
    <div
      data-no-dnd
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/30 p-3 backdrop-blur-sm sm:p-6"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[calc(100dvh-1.5rem)] w-[640px] max-w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(17,24,39,0.10),0_4px_12px_rgba(17,24,39,0.04)] sm:max-h-[90vh] dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-white px-4 py-2.5 dark:border-neutral-900 dark:bg-neutral-950">
          <div className="flex min-w-0 items-center gap-3">
            {/* When the open task is a subtask, offer a way back up to its
                parent — the modal drills in place, so this is the climb-out. */}
            {current.parent_task_id ? (
              <button
                type="button"
                onClick={() => {
                  if (parentTask) onNavigateTask(parentTask);
                }}
                disabled={!parentTask}
                title={
                  parentTask
                    ? `Back to “${parentTask.title}”`
                    : "Back to parent task"
                }
                className="inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-indigo-600 disabled:cursor-default disabled:opacity-60 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-indigo-400"
              >
                <span aria-hidden className="shrink-0">
                  ←
                </span>
                <span className="truncate">
                  {parentTask ? parentTask.title : "Parent task"}
                </span>
              </button>
            ) : null}
            <SaveStatusDot status={saveStatus} error={lastError} />
          </div>
          <div className="flex shrink-0 items-center gap-3.5">
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
            {/* The task on screen has an address (`?task=<id>` while the editor
                is open); this hands out the canonical /task/<id> form of it. */}
            <button
              type="button"
              onClick={copyLink}
              aria-label="Copy link to task"
              title="Copy link to task (⇧⌘C)"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900"
            >
              <svg
                aria-hidden
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <path d="M10 14a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1 1M14 10a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1-1" />
              </svg>
            </button>
            <TaskMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              onDelete={() => setConfirmingDelete(true)}
            />
          </div>
        </div>

        {/* Scrollable region — keeps the modal within the viewport on short
            screens (phones) instead of overflowing off the bottom. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Input — the completion circle sits to the left of the title, the
            same arrangement as a task row in the list. The wrapper pins it to
            the title's line so it doesn't drift when tags wrap the input to a
            second row. */}
        <div className="flex items-start gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-neutral-900 dark:bg-neutral-900/50">
          {/* pt matches the input card's own top inset (1px border + py-2.5),
              so the circle lands on the title's line and stays there when the
              chip row appears underneath. */}
          <div className="shrink-0 pt-[11px]">
            <CompleteToggle
              status={current.status}
              onChange={(s) => setField("status", s)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <SlashCommandInput
              value={titleDraft}
              onChange={handleTitleChange}
              parsedTokens={tokens}
              onRemoveTag={handleRemoveTag}
              onAddTag={handleAddTag}
              autoFocus
              selectOnFocus={draft}
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 px-5 py-4">
          {/* DATE calendar */}
          <div>
            <div className="mb-2 flex items-baseline gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                Date
              </span>
              <span className="text-sm font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                {current.scheduled_date
                  ? formatFullDate(current.scheduled_date)
                  : "Not scheduled"}
              </span>
              {current.scheduled_date ? (
                <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                  · {formatRelativeDay(current.scheduled_date)}
                </span>
              ) : null}
              {current.scheduled_date && current.scheduled_time ? (
                <span className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">
                  {formatTimeOfDay(current.scheduled_time)}
                </span>
              ) : null}
            </div>
            <ScheduleCalendar
              scheduledDate={current.scheduled_date}
              deadlineDate={current.deadline_date}
              busyness={busyness}
              onPickDate={onPickDate}
              onChangeDeadlineDate={(v) => setField("deadline_date", v)}
            />
            {/* Time-of-day for the chosen do date — only meaningful with a
                scheduled_date, so it appears once a day is picked. */}
            {current.scheduled_date ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                  Time
                </span>
                <ScheduledTimeField
                  value={current.scheduled_time}
                  onChange={(v) => setField("scheduled_time", v)}
                />
              </div>
            ) : null}
          </div>

          {/* Inline meta — a fixed 4-column grid. Each control lives in its
              own 1fr cell, so changing one value (or previewing on hover) can
              never change another field's width and shove its neighbours. */}
          <div className="grid grid-cols-4 border-y border-neutral-100 dark:border-neutral-900">
            <StatusField
              value={current.status}
              onChange={(s) => setField("status", s)}
            />
            <PriorityField
              dividerLeft
              value={current.priority}
              onChange={(p) => setField("priority", p)}
            />
            <EstimateField
              dividerLeft
              value={current.duration_minutes}
              onChange={(m) => setField("duration_minutes", m)}
            />
            <ProjectField
              dividerLeft
              projects={allProjects}
              value={current.project_id}
              userId={current.user_id}
              onChange={(id) => setField("project_id", id)}
              onCreated={(p) => setCreatedProjects((prev) => [...prev, p])}
            />
          </div>

          {/* Subtasks */}
          <SubtasksSection
            parentTask={current}
            tasksApi={tasksApi}
            onOpenSubtask={onNavigateTask}
          />

          {/* Notes */}
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
              Notes
            </div>
            <NotesField
              value={current.description}
              onChange={(v) => setField("description", v)}
            />
          </div>
        </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-neutral-900 dark:bg-neutral-900/50">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
              <Kbd>1</Kbd>-<Kbd>4</Kbd>
              <span className="mx-1">priority</span>
              <Kbd>Esc</Kbd>
              <span className="mx-1">close</span>
            </div>
          </div>
          <CloseButton onClick={handleClose} />
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
      data-no-dnd
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
