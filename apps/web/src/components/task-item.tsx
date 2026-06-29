"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  QUICK_SCHEDULE,
  formatDuration,
  formatWhenTime,
  resolveQuickSchedule,
} from "@do-done/shared";
import type { Task, Project, TaskPriority } from "@do-done/shared";
import { formatRrule } from "@do-done/task-engine";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { ScheduleButton } from "./schedule-button";
import {
  TaskEditModalV2,
  PickerPopover,
  useClickOutside,
  estimateBarIndex,
  WhenTimeField,
  PRIORITY_OPTIONS,
  ESTIMATE_OPTIONS,
} from "./task-edit-modal-v2";
import { ProjectPickerPopover } from "./project-picker";
import { TaskContextMenu } from "./task-context-menu";
import { useUndoToast } from "./undo-toast";

export interface TaskItemProps {
  task: Task;
  projects?: Project[];
}

/**
 * Compact priority indicator: 4 vertical bars with increasing heights.
 * Bars lit count = 5 − priority number (so p1 lights all 4, p4 lights one).
 * Static, non-interactive — the editor uses the bigger PrioritySignal.
 */
function PriorityBars({ priority }: { priority: TaskPriority }) {
  const litCount = { p1: 4, p2: 3, p3: 2, p4: 1 }[priority];
  const color = PRIORITY_CONFIG[priority].color;
  const heights = ["h-1", "h-1.5", "h-2", "h-2.5"];
  return (
    <span
      className="inline-flex items-end gap-[2px]"
      title={`Priority: ${PRIORITY_CONFIG[priority].label}`}
      aria-label={`Priority ${PRIORITY_CONFIG[priority].label}`}
    >
      {[0, 1, 2, 3].map((i) => {
        const lit = i < litCount;
        return (
          <span
            key={i}
            className={`block w-[3px] rounded-[1px] ${heights[i]} ${
              lit ? "" : "bg-neutral-200 dark:bg-neutral-700"
            }`}
            style={lit ? { backgroundColor: color } : undefined}
          />
        );
      })}
    </span>
  );
}

const PRIORITY_ACCENT: Record<TaskPriority, string> = {
  p1: "bg-red-500",
  p2: "bg-amber-500",
  p3: "bg-indigo-500",
  p4: "bg-neutral-400",
};

/**
 * The priority bars on the row, but clickable: opens a small popover to set
 * priority inline without opening the full task modal. stopPropagation keeps
 * the row's own click (which opens the modal) from firing.
 */
function InlinePriorityEditor({
  priority,
  onChange,
}: {
  priority: TaskPriority;
  onChange: (p: TaskPriority) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));
  return (
    <div
      ref={ref}
      className="relative flex shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Priority: ${PRIORITY_CONFIG[priority].label} — click to change`}
        className="rounded p-0.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <PriorityBars priority={priority} />
      </button>
      {open ? (
        <PickerPopover
          ariaLabel="Priority options"
          options={PRIORITY_OPTIONS.map((p) => ({
            key: p.value,
            code: p.code,
            label: p.label,
            selected: p.value === priority,
            onSelect: () => {
              onChange(p.value);
              setOpen(false);
            },
            accentClass: PRIORITY_ACCENT[p.value],
          }))}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The "~1hr" estimate chip, but clickable: opens a popover to change the
 * estimate inline. Only rendered when the task already has a duration.
 */
function InlineEstimateEditor({
  durationMinutes,
  onChange,
}: {
  durationMinutes: number;
  onChange: (minutes: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));
  const activeIdx = estimateBarIndex(durationMinutes);
  return (
    <div
      ref={ref}
      className="relative"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Time estimate — click to change"
        className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
      >
        ~{formatDuration(durationMinutes)}
      </button>
      {open ? (
        <PickerPopover
          ariaLabel="Estimate options"
          options={ESTIMATE_OPTIONS.map((b, i) => ({
            key: String(b.minutes),
            code: b.code,
            label: b.label,
            selected: i === activeIdx,
            onSelect: () => {
              onChange(b.minutes);
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

/**
 * The project chip on the row, but clickable: opens the project picker to
 * switch, clear, or create-and-assign a project inline. Only rendered when
 * the task already has a project (adding one from scratch lives in the modal).
 */
function InlineProjectEditor({
  project,
  projects,
  selectedId,
  userId,
  onChange,
  onCreated,
}: {
  project: Project;
  projects: Project[];
  selectedId: string | null;
  userId: string;
  onChange: (projectId: string | null) => void;
  onCreated: (project: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Project: ${project.name} — click to change`}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: project.color }}
        />
        {project.name}
      </button>
      {open ? (
        <ProjectPickerPopover
          projects={projects}
          selectedId={selectedId}
          userId={userId}
          onSelect={onChange}
          onCreated={onCreated}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) return "Today";
  if (date.getTime() === tomorrow.getTime()) return "Tomorrow";

  const diff = Math.ceil(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return "Overdue";
  if (diff <= 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dueDateColor(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) return "text-red-500 bg-red-50 dark:bg-red-950";
  if (date.getTime() === today.getTime())
    return "text-orange-600 bg-orange-50 dark:bg-orange-950";
  return "text-neutral-500 bg-neutral-100 dark:bg-neutral-800";
}

export interface WhenPatch {
  when_date?: string | null;
  when_time?: string | null;
}

/**
 * The scheduling chip on the row, but clickable: opens a popover to set the
 * do-date or time-of-day inline — mirroring the inline priority/estimate
 * editors. Renders nothing when the task has no schedule at all (the row's
 * "Find a time" affordance covers that case).
 */
function InlineWhenEditor({
  whenDate,
  whenTime,
  dueDate,
  dueTime,
  onChange,
}: {
  whenDate: string | null;
  whenTime: string | null;
  dueDate: string | null;
  dueTime: string | null;
  onChange: (patch: WhenPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The visible chip mirrors whichever schedule field is set, in priority
  // order: do-date > deadline.
  let label: string | null = null;
  let chipClass = "";
  let title = "";
  if (whenDate) {
    label = formatDueDate(whenDate) + (whenTime ? ` ${formatWhenTime(whenTime)}` : "");
    chipClass = dueDateColor(whenDate);
    title = whenTime ? `Scheduled for ${whenDate} at ${whenTime}` : `Scheduled for ${whenDate}`;
  } else if (dueDate) {
    label = formatDueDate(dueDate) + (dueTime ? ` ${formatWhenTime(dueTime)}` : "");
    chipClass = dueDateColor(dueDate);
    title = dueTime ? `Due ${dueDate} at ${dueTime}` : `Due ${dueDate}`;
  }
  if (!label) return null;

  // Friendly quick-pick labels, each resolving to a concrete calendar date.
  const quick = QUICK_SCHEDULE.map((q) => ({
    label: q.label,
    date: resolveQuickSchedule(q.key),
  }));

  return (
    <div
      ref={ref}
      className="relative flex shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${title} — click to reschedule`}
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize transition-shadow hover:ring-1 hover:ring-inset hover:ring-neutral-300 dark:hover:ring-neutral-700 ${chipClass}`}
      >
        {label}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Reschedule"
          className="absolute right-0 top-full z-30 mt-2 w-60 rounded-lg border border-neutral-200 bg-white p-2.5 shadow-[0_12px_24px_rgba(17,24,39,0.10),0_2px_6px_rgba(17,24,39,0.05)] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            When
          </div>
          <div className="grid grid-cols-3 gap-1">
            {quick.map((q) => {
              const selected = whenDate === q.date;
              return (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => onChange({ when_date: q.date })}
                  className={`rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                    selected
                      ? "bg-indigo-500 text-white"
                      : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="w-8 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
              On
            </span>
            <input
              type="date"
              value={whenDate ?? ""}
              onChange={(e) => onChange({ when_date: e.target.value || null })}
              className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[13px] text-neutral-800 outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
            />
          </div>
          {/* Time-of-day reuses the modal's half-hour scroller (auto-centered
              on "now", with a "Specific time" escape hatch) so inline editing
              matches the full editor exactly. Only meaningful once a do-date is
              set, mirroring the modal's gating. */}
          {whenDate ? (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-8 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                At
              </span>
              <WhenTimeField
                value={whenTime}
                onChange={(v) => onChange({ when_time: v })}
              />
            </div>
          ) : null}
          {whenDate || whenTime ? (
            <button
              type="button"
              onClick={() => {
                onChange({ when_date: null, when_time: null });
                setOpen(false);
              }}
              aria-label="Clear schedule"
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

export function TaskItem({ task, projects }: TaskItemProps) {
  const router = useRouter();
  const [completed, setCompleted] = useState(task.status === "done");
  const [editing, setEditing] = useState(false);
  // Right-click context menu, anchored at the cursor. Null = closed.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  // Optimistic local state for the inline row editors — keeps the row snappy
  // before the server round-trip / router.refresh lands.
  const [priority, setPriority] = useState(task.priority);
  const [duration, setDuration] = useState(task.duration_minutes);
  // Like the schedule fields below, these inline-editable values must sync back
  // from props after a router.refresh — otherwise an edit made elsewhere (e.g.
  // the edit modal) leaves the row's optimistic state frozen at its old value.
  useEffect(() => setPriority(task.priority), [task.priority]);
  useEffect(() => setDuration(task.duration_minutes), [task.duration_minutes]);
  // Schedule fields are optimistic too (for the inline When editor) but also
  // sync back from props — the Upcoming view mutates when_date on drag, and
  // router.refresh re-feeds the server value after any edit.
  const [whenDate, setWhenDate] = useState(task.when_date);
  const [whenTime, setWhenTime] = useState(task.when_time);
  useEffect(() => setWhenDate(task.when_date), [task.when_date]);
  useEffect(() => setWhenTime(task.when_time), [task.when_time]);
  const [, startTransition] = useTransition();
  const toast = useUndoToast();
  // "Find a time" suggests a calendar slot — only useful when the task has no
  // schedule at all. Once any date/deadline exists, the date chip itself is the
  // (clickable) reschedule affordance, so the clock would be redundant.
  const hasSchedule = !!whenDate || !!task.due_date;
  const canSchedule = !!duration && !hasSchedule;
  // Optimistic project state mirrors the priority/estimate inline editors.
  // `createdProjects` holds projects made via the inline picker so the chip can
  // render them before the router.refresh round-trip lands.
  const [projectId, setProjectId] = useState(task.project_id);
  useEffect(() => setProjectId(task.project_id), [task.project_id]);
  const [createdProjects, setCreatedProjects] = useState<Project[]>([]);
  const allProjects = useMemo(
    () => [...(projects ?? []), ...createdProjects],
    [projects, createdProjects]
  );
  const project = projectId
    ? allProjects.find((p) => p.id === projectId) ?? null
    : null;
  // STATUS_CONFIG[task.status] can be undefined for an unmigrated DB still
  // serving legacy 'todo' / 'archived' values — guard before reading .color.
  const statusCfg = STATUS_CONFIG[task.status];
  // The checkbox circle now reflects status (not priority). Fall back to a
  // neutral gray if the status is unknown.
  const statusColor = statusCfg?.color ?? "#94a3b8";
  // Show a status text chip for everything that isn't the boring default —
  // the circle color already encodes status, so this is redundant for the
  // default cases. Kept for `next`, `in_progress`, `done`, `cancelled`.
  const showStatusBadge =
    !!statusCfg &&
    task.status !== "not_started" &&
    task.status !== "inbox";

  async function handleToggleComplete(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !completed;
    setCompleted(next);

    const tasks = await getClientTasksApi();
    const { error } = next
      ? await tasks.complete(task.id)
      : await tasks.reopen(task.id);

    if (error) {
      setCompleted(!next);
      console.error("Failed to update task:", error);
      return;
    }

    if (next) {
      toast.show({
        message: `Completed “${task.title}”`,
        undo: async () => {
          const api = await getClientTasksApi();
          await api.reopen(task.id);
          setCompleted(false);
          startTransition(() => router.refresh());
        },
      });
    }

    startTransition(() => router.refresh());
  }

  async function handlePriorityChange(next: TaskPriority) {
    const prev = priority;
    setPriority(next);
    const tasks = await getClientTasksApi();
    const { error } = await tasks.update(task.id, { priority: next });
    if (error) {
      setPriority(prev);
      console.error("Failed to update priority:", error);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleDurationChange(next: number) {
    const prev = duration;
    setDuration(next);
    const tasks = await getClientTasksApi();
    const { error } = await tasks.update(task.id, { duration_minutes: next });
    if (error) {
      setDuration(prev);
      console.error("Failed to update estimate:", error);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleProjectChange(next: string | null) {
    const prev = projectId;
    setProjectId(next);
    const tasks = await getClientTasksApi();
    const { error } = await tasks.update(task.id, { project_id: next });
    if (error) {
      setProjectId(prev);
      console.error("Failed to update project:", error);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleWhenChange(patch: WhenPatch) {
    const prev = { when_date: whenDate, when_time: whenTime };
    if ("when_date" in patch) setWhenDate(patch.when_date ?? null);
    if ("when_time" in patch) setWhenTime(patch.when_time ?? null);
    const tasks = await getClientTasksApi();
    const { error } = await tasks.update(task.id, patch);
    if (error) {
      setWhenDate(prev.when_date);
      setWhenTime(prev.when_time);
      console.error("Failed to update schedule:", error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <>
      {/* `@container` makes the row stack on its OWN available width rather
          than the viewport, so it goes two-row in any narrow column (a phone,
          a split pane, a narrow sidebar) — not just on small screens. Below
          ~32rem (`@lg`) the title takes its own row. */}
      <div className="@container">
      <div
        className="group flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900 @lg:items-center"
        onClick={() => setEditing(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          // Clamp so the ~256px-wide menu stays on screen near the edges.
          const menuW = 280;
          const menuH = 460;
          setMenuPos({
            x: Math.min(e.clientX, window.innerWidth - menuW),
            y: Math.min(e.clientY, window.innerHeight - menuH),
          });
        }}
      >
        <button
          onClick={handleToggleComplete}
          className="flex h-5 shrink-0 items-center justify-center"
          aria-label={completed ? "Mark incomplete" : "Mark complete"}
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors"
            style={{
              borderColor: completed ? "#d4d4d4" : statusColor,
              backgroundColor: completed ? "#d4d4d4" : "transparent",
            }}
          >
            {completed && (
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
            )}
          </span>
        </button>

        {/* Wrapper keeps the priority bars centered on the title line when the
            row stacks into two rows. */}
        <div className="flex h-5 shrink-0 items-center @lg:h-auto">
          <InlinePriorityEditor priority={priority} onChange={handlePriorityChange} />
        </div>

        {/* Title gets its own row when the container is narrow so it's never
            crowded out by the metadata; from @lg up everything collapses back
            to a single inline row (the metadata wrapper becomes
            `display: contents`). */}
        <div className="flex min-w-0 flex-1 flex-col gap-1 @lg:flex-row @lg:items-center @lg:gap-2">
          <span
            className={`line-clamp-2 text-sm leading-snug @lg:line-clamp-none ${
              completed
                ? "text-neutral-400 line-through dark:text-neutral-600"
                : "text-neutral-900 dark:text-neutral-100"
            }`}
          >
            {task.title}
          </span>

          <div className="flex flex-wrap items-center gap-2 @lg:contents">
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
              >
                {tag}
              </span>
            ))}

            {task.recurrence_rule && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-600 dark:bg-violet-950 dark:text-violet-400"
                title={task.recurrence_rule}
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {formatRrule(task.recurrence_rule)}
              </span>
            )}

            {project && (
              <InlineProjectEditor
                project={project}
                projects={allProjects}
                selectedId={projectId}
                userId={task.user_id}
                onChange={handleProjectChange}
                onCreated={(p) => setCreatedProjects((prev) => [...prev, p])}
              />
            )}

            {duration && (
              <InlineEstimateEditor
                durationMinutes={duration}
                onChange={handleDurationChange}
              />
            )}

            {showStatusBadge && statusCfg && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  color: statusCfg.color,
                  backgroundColor: `${statusCfg.color}1a`,
                }}
                title={statusCfg.label}
              >
                {statusCfg.label}
              </span>
            )}

            {/* Effective scheduling chip — clickable to reschedule inline
                (do-date if set, else deadline). When a do-date and a distinct
                deadline both exist, show the deadline as a static second chip.
                `@lg:ml-auto` pushes the pair to the row's right edge on wide
                containers, preserving the desktop layout. */}
            {(whenDate || task.due_date) && (
              <div className="flex items-center gap-2 @lg:ml-auto">
                <InlineWhenEditor
                  whenDate={whenDate}
                  whenTime={whenTime}
                  dueDate={task.due_date}
                  dueTime={task.due_time}
                  onChange={handleWhenChange}
                />
                {whenDate && task.due_date && whenDate !== task.due_date && (
                  <span
                    className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-950 dark:text-red-400"
                    title={`Hard deadline ${task.due_date}`}
                  >
                    due {formatDueDate(task.due_date)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Always visible on touch (no hover); reveal on hover for pointer
            devices to keep the desktop list calm. */}
        <div
          className="flex shrink-0 gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {canSchedule && duration && (
            <ScheduleButton taskId={task.id} durationMinutes={duration} />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            aria-label="Edit task"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </button>
        </div>
      </div>
      </div>

      <TaskEditModalV2
        task={task}
        projects={allProjects}
        open={editing}
        onClose={() => setEditing(false)}
      />

      {menuPos &&
        createPortal(
          <div
            className="fixed inset-0 z-50"
            onClick={() => setMenuPos(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuPos(null);
            }}
          >
            <div
              className="absolute"
              style={{ top: menuPos.y, left: menuPos.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <TaskContextMenu
                task={task}
                projects={allProjects}
                onEdit={() => setEditing(true)}
                onClose={() => setMenuPos(null)}
                onMutated={() => startTransition(() => router.refresh())}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
