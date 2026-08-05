"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  QUICK_SCHEDULE,
  TASK_COMPLETE_CHECK_MS,
  TASK_COMPLETE_COLLAPSE_MS,
  formatCompletedDate,
  formatDuration,
  formatScheduleHint,
  formatTimeOfDay,
  resolveQuickSchedule,
} from "@do-done/shared";
import type { Task, Project, TaskPriority } from "@do-done/shared";
import { formatRrule } from "@do-done/task-engine";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { useCompletionExit } from "@/lib/use-completion-exit";
import { useKeepsCompleted } from "@/lib/task-row-behavior";
import { useHoldWhileEditing } from "@/lib/task-editing-hold";
import { LinkifiedText } from "./linkified-text";
import { ScheduleButton } from "./schedule-button";
import {
  TaskEditModalV2,
  PickerPopover,
  useClickOutside,
  estimateBarIndex,
  ScheduledTimeField,
  PRIORITY_OPTIONS,
  ESTIMATE_OPTIONS,
} from "./task-edit-modal-v2";
import { ProjectPickerPopover } from "./project-picker";
import { TaskContextMenu } from "./task-context-menu";
import { BulkActionMenu } from "./bulk-action-menu";
import { useUndoToast } from "./undo-toast";
import {
  useTaskSelection,
  orderedTaskIdsFromDom,
} from "@/lib/task-selection";

export interface TaskItemProps {
  task: Task;
  projects?: Project[];
  /** Suppress the per-row status pill. Set when the surrounding list is
   *  grouped by status: the group header already states the status for every
   *  row, so the badge is pure redundancy there. Defaults to false (shown). */
  hideStatusBadge?: boolean;
  /** The parent task, when the row is a subtask and the caller already has it
   *  in hand (e.g. a list that also holds the parent). Supplies the parent
   *  title for the "↳ parent" reference without a round-trip; when omitted the
   *  row resolves the title lazily from `task.parent_task_id`. */
  parentTask?: Pick<Task, "id" | "title"> | null;
  /** Suppress the "↳ parent" subtask reference. Set where the parent context is
   *  already obvious — e.g. a task's own detail page listing its subtasks right
   *  beneath it — so the breadcrumb isn't noisy redundancy. */
  hideParentRef?: boolean;
}

/**
 * A subtask breadcrumb marker: a corner arrow (↳) that both flags the row as a
 * subtask and points at its parent. Matches the app's hand-drawn icon style.
 */
function SubtaskArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 5v6a4 4 0 004 4h12" />
      <path d="M15 11l5 4-5 4" />
    </svg>
  );
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

function formatTaskDate(dateStr: string): string {
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

function taskDateColor(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) return "text-red-500 bg-red-50 dark:bg-red-950";
  if (date.getTime() === today.getTime())
    return "text-orange-600 bg-orange-50 dark:bg-orange-950";
  return "text-neutral-500 bg-neutral-100 dark:bg-neutral-800";
}

export interface SchedulePatch {
  scheduled_date?: string | null;
  scheduled_time?: string | null;
}

/**
 * The scheduling chip on the row, but clickable: opens a popover to set the
 * do-date or time-of-day inline — mirroring the inline priority/estimate
 * editors. Renders nothing when the task has no schedule at all (the row's
 * "Find a time" affordance covers that case).
 */
function InlineScheduleEditor({
  scheduledDate,
  scheduledTime,
  deadlineDate,
  deadlineTime,
  onChange,
}: {
  scheduledDate: string | null;
  scheduledTime: string | null;
  deadlineDate: string | null;
  deadlineTime: string | null;
  onChange: (patch: SchedulePatch) => void;
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
  if (scheduledDate) {
    label = formatTaskDate(scheduledDate) + (scheduledTime ? ` ${formatTimeOfDay(scheduledTime)}` : "");
    chipClass = taskDateColor(scheduledDate);
    title = scheduledTime ? `Scheduled for ${scheduledDate} at ${scheduledTime}` : `Scheduled for ${scheduledDate}`;
  } else if (deadlineDate) {
    label = formatTaskDate(deadlineDate) + (deadlineTime ? ` ${formatTimeOfDay(deadlineTime)}` : "");
    chipClass = taskDateColor(deadlineDate);
    title = deadlineTime ? `Deadline ${deadlineDate} at ${deadlineTime}` : `Deadline ${deadlineDate}`;
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
            Date
          </div>
          <div className="grid grid-cols-3 gap-1">
            {quick.map((q) => {
              const selected = scheduledDate === q.date;
              return (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => onChange({ scheduled_date: q.date })}
                  className={`flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                    selected
                      ? "bg-indigo-500 text-white"
                      : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  <span>{q.label}</span>
                  <span
                    className={`text-[10px] font-normal ${
                      selected
                        ? "text-white/70"
                        : "text-neutral-400 dark:text-neutral-500"
                    }`}
                  >
                    {formatScheduleHint(q.date)}
                  </span>
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
              value={scheduledDate ?? ""}
              onChange={(e) => onChange({ scheduled_date: e.target.value || null })}
              className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[13px] text-neutral-800 outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
            />
          </div>
          {/* Time-of-day reuses the modal's half-hour scroller (auto-centered
              on "now", with a "Specific time" escape hatch) so inline editing
              matches the full editor exactly. Only meaningful once a do-date is
              set, mirroring the modal's gating. */}
          {scheduledDate ? (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-8 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                At
              </span>
              <ScheduledTimeField
                value={scheduledTime}
                onChange={(v) => onChange({ scheduled_time: v })}
              />
            </div>
          ) : null}
          {scheduledDate || scheduledTime ? (
            <button
              type="button"
              onClick={() => {
                onChange({ scheduled_date: null, scheduled_time: null });
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

/**
 * Positions the right-click context menu at the cursor, then measures the
 * rendered menu and nudges it fully back on-screen: shifted left if it would
 * spill off the right edge, and shifted up if it would spill off the bottom —
 * the common case for rows near the bottom of a long list. Re-measures whenever
 * the menu resizes (the Deadline / Move-to sections expand in place) or the
 * window resizes, and caps the height so an unusually tall menu stays scrollable
 * inside a short viewport instead of overflowing it.
 */
function ContextMenuPositioner({
  anchor,
  children,
}: {
  anchor: { x: number; y: number };
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Null until measured; we render hidden for the first paint so the menu never
  // flashes at an unclamped position before the clamp runs.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const MARGIN = 8;
    const reposition = () => {
      const { width, height } = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = anchor.x;
      if (left + width > vw - MARGIN) left = vw - MARGIN - width;
      left = Math.max(MARGIN, left);

      let top = anchor.y;
      if (top + height > vh - MARGIN) top = vh - MARGIN - height;
      top = Math.max(MARGIN, top);

      setPos({ top, left });
    };

    reposition();
    // Section expansion changes the menu's height without a window resize —
    // observe the element itself so it re-clamps as it grows.
    const ro = new ResizeObserver(reposition);
    ro.observe(el);
    window.addEventListener("resize", reposition);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [anchor.x, anchor.y]);

  return (
    <div
      ref={ref}
      className="absolute max-h-[calc(100vh-16px)] overflow-y-auto"
      style={{
        top: pos?.top ?? anchor.y,
        left: pos?.left ?? anchor.x,
        visibility: pos ? "visible" : "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function TaskItem({
  task,
  projects,
  hideStatusBadge,
  parentTask,
  hideParentRef,
}: TaskItemProps) {
  const router = useRouter();
  const [completed, setCompleted] = useState(task.status === "done");
  // Completion is the one edit that removes the row from most lists, so it gets
  // an exit rather than a disappearance. See `useCompletionExit`.
  const exit = useCompletionExit();
  const keepsCompleted = useKeepsCompleted();
  // Parent title for the "↳ parent" subtask reference. Prefer the prop the
  // caller supplied; otherwise fall back to a lazily-resolved title so any list
  // view flags a subtask without every caller having to thread the parent
  // through. Derived (not synced via an effect) so the prop stays authoritative.
  const isSubtask = !!task.parent_task_id && !hideParentRef;
  const [fetchedParentTitle, setFetchedParentTitle] = useState<string | null>(
    null
  );
  const parentTitle = parentTask?.title ?? fetchedParentTitle;
  useEffect(() => {
    // Skip when there's nothing to resolve: not a subtask, ref suppressed, or
    // the caller already handed us the title.
    if (!isSubtask || parentTask?.title) return;
    const parentId = task.parent_task_id;
    if (!parentId) return;
    let cancelled = false;
    (async () => {
      const tasks = await getClientTasksApi();
      const { data } = await tasks.getById(parentId);
      if (!cancelled && data) setFetchedParentTitle(data.title);
    })();
    return () => {
      cancelled = true;
    };
  }, [isSubtask, task.parent_task_id, parentTask?.title]);
  const [editing, setEditing] = useState(false);
  // The editor auto-saves, and a save can re-qualify the task out of the list
  // it was opened from — which used to unmount this row, and the modal it
  // renders along with it. Hold the row until the editor closes, so the edit
  // stays undoable and further edits stay possible.
  useHoldWhileEditing(task, editing);
  // Right-click context menu, anchored at the cursor. Null = closed.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  // Bulk right-click menu, opened when this row is right-clicked while it's
  // part of a multi-selection. Separate state so the two menus never collide.
  const [bulkMenuPos, setBulkMenuPos] = useState<{ x: number; y: number } | null>(
    null
  );

  // Multi-select. `registerTask`/`unregisterTask` are stable, so the row only
  // (re)registers its Task when the task itself changes — not on every
  // selection change elsewhere in the list.
  const selection = useTaskSelection();
  const { registerTask, unregisterTask } = selection;
  const selected = selection.isSelected(task.id);
  useEffect(() => {
    registerTask(task);
    return () => unregisterTask(task.id);
  }, [registerTask, unregisterTask, task]);
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
  // sync back from props — the Upcoming view mutates scheduled_date on drag, and
  // router.refresh re-feeds the server value after any edit.
  const [scheduledDate, setScheduledDate] = useState(task.scheduled_date);
  const [scheduledTime, setScheduledTime] = useState(task.scheduled_time);
  useEffect(() => setScheduledDate(task.scheduled_date), [task.scheduled_date]);
  useEffect(() => setScheduledTime(task.scheduled_time), [task.scheduled_time]);
  const [, startTransition] = useTransition();
  const toast = useUndoToast();
  // "Find a time" suggests a calendar slot — only useful when the task has no
  // schedule at all. Once any date/deadline exists, the date chip itself is the
  // (clickable) reschedule affordance, so the clock would be redundant.
  const hasSchedule = !!scheduledDate || !!task.deadline_date;
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
  // default cases. Kept for `next`, `later`, `in_progress`, `done`,
  // `cancelled`. When the list is grouped by status, the group header states
  // the status for every row, so the chip is redundant there too — hide it.
  const showStatusBadge =
    !hideStatusBadge &&
    !!statusCfg &&
    task.status !== "not_started" &&
    task.status !== "inbox";

  async function handleToggleComplete(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !completed;
    // Paint first: the check springs in and the title strikes through on this
    // frame, before anything touches the network.
    setCompleted(next);

    // In a list that keeps completed tasks there is nothing to leave — the row
    // stays put wearing its completed styling. Everywhere else it holds for a
    // beat and then collapses, so the rows below slide up into the gap.
    //
    // The exit starts now rather than after the write, or a slow connection
    // would leave the row sitting there mid-gesture. It's a promise we can
    // retract: a failed write cancels it and the row comes back.
    const leaving = !keepsCompleted;
    let collapsed = false;
    let written = false;
    // The refresh replaces this row with the server's answer, so it has to wait
    // for both — before the write it re-reads the old status, and before the
    // collapse it yanks the row out from under its own animation.
    const refreshWhenSettled = () => {
      if (collapsed && written) startTransition(() => router.refresh());
    };
    if (leaving) {
      exit.start(() => {
        collapsed = true;
        refreshWhenSettled();
      });
    } else {
      collapsed = true;
    }

    const revert = () => {
      setCompleted(!next);
      exit.cancel();
    };

    let error: Error | null = null;
    try {
      const tasks = await getClientTasksApi();
      ({ error } = next
        ? await tasks.complete(task.id)
        : await tasks.reopen(task.id));
    } catch (err) {
      error = err as Error;
    }

    if (error) {
      revert();
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
          exit.cancel();
          startTransition(() => router.refresh());
        },
      });
    }

    written = true;
    refreshWhenSettled();
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

  async function handleScheduleChange(patch: SchedulePatch) {
    const prev = { scheduled_date: scheduledDate, scheduled_time: scheduledTime };
    if ("scheduled_date" in patch) setScheduledDate(patch.scheduled_date ?? null);
    if ("scheduled_time" in patch) setScheduledTime(patch.scheduled_time ?? null);
    const tasks = await getClientTasksApi();
    const { error } = await tasks.update(task.id, patch);
    if (error) {
      setScheduledDate(prev.scheduled_date);
      setScheduledTime(prev.scheduled_time);
      console.error("Failed to update schedule:", error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <>
      {/* Collapse shell for the completion exit. `grid-template-rows: 1fr → 0fr`
          animates a height the row never had to measure, and because the row
          shrinks in place the ones below it slide up on their own — no list-level
          layout animation, nothing for dnd-kit to fight. Inert (`1fr`, no
          transition running) until a completion actually starts. */}
      <div
        className="grid transition-[grid-template-rows,opacity] ease-out motion-reduce:transition-none"
        style={{
          gridTemplateRows: exit.collapsing ? "0fr" : "1fr",
          opacity: exit.collapsing ? 0 : 1,
          transitionDuration: `${TASK_COMPLETE_COLLAPSE_MS}ms`,
        }}
        aria-hidden={exit.collapsing || undefined}
      >
      {/* Clipping is what turns the `0fr` track into a visibly shrinking row,
          but it must not be on while the row is idle: the inline priority,
          project and schedule popovers are absolutely positioned *inside* the
          row, and a standing `overflow: hidden` would cut them off. */}
      <div className={exit.collapsing ? "overflow-hidden" : undefined}>
      {/* `@container` makes the row stack on its OWN available width rather
          than the viewport, so it goes two-row in any narrow column (a phone,
          a split pane, a narrow sidebar) — not just on small screens. Below
          ~32rem (`@lg`) the title takes its own row. */}
      <div className="@container">
      <div
        data-task-row={task.id}
        className={`group/row flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors @lg:items-center ${
          selected
            ? "bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/60"
            : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
        }`}
        onMouseDown={(e) => {
          // Stop Shift-click from painting a native text selection across rows.
          if (e.shiftKey) e.preventDefault();
        }}
        onClick={(e) => {
          // ⌘/Ctrl-click toggles one row; Shift-click extends a range; a plain
          // click while a selection is active toggles the row (selection mode).
          // Only a plain click with nothing selected opens the editor.
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            selection.toggle(task.id);
            return;
          }
          if (e.shiftKey) {
            e.preventDefault();
            selection.selectRange(task.id, orderedTaskIdsFromDom());
            return;
          }
          if (selection.isActive) {
            selection.toggle(task.id);
            return;
          }
          setEditing(true);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          // Store the raw cursor position; ContextMenuPositioner measures the
          // rendered menu and nudges it back on-screen near the edges (a fixed
          // clamp can't, since the menu's height varies with its content).
          const pos = { x: e.clientX, y: e.clientY };
          // Right-clicking inside a multi-selection acts on the whole set;
          // right-clicking a row that isn't part of it drops the selection and
          // shows the single-task menu, so the menu always matches the row.
          if (selection.isSelected(task.id) && selection.count > 1) {
            setBulkMenuPos(pos);
          } else {
            if (selection.isActive) selection.clear();
            setMenuPos(pos);
          }
        }}
      >
        {/* Wrapper keeps the completion circle centered on the title line when
            the row stacks into two rows. Selection has no per-row checkbox —
            ⌘/Ctrl-click, Shift-click and the keyboard shortcuts drive it, and
            the row highlight is the indicator. */}
        <div className="flex h-5 shrink-0 items-center @lg:h-auto">
          <button
            onClick={handleToggleComplete}
            className="flex h-5 shrink-0 items-center justify-center"
            aria-label={completed ? "Mark incomplete" : "Mark complete"}
          >
            {/* The check is always mounted and scaled to nothing when the task
                is open, so ticking it off animates a transform instead of a
                mount — a freshly mounted element has no "before" to move from.
                The overshoot easing gives it the little bounce that reads as a
                stamp rather than a fade. */}
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full border-2 transition-[background-color,border-color,transform] ease-out motion-reduce:transition-none"
              style={{
                borderColor: completed ? "#d4d4d4" : statusColor,
                backgroundColor: completed ? "#d4d4d4" : "transparent",
                transitionDuration: `${TASK_COMPLETE_CHECK_MS}ms`,
              }}
            >
              <svg
                className="h-3 w-3 text-white transition-transform motion-reduce:transition-none"
                style={{
                  transform: completed ? "scale(1)" : "scale(0)",
                  transitionDuration: `${TASK_COMPLETE_CHECK_MS}ms`,
                  transitionTimingFunction:
                    "cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </span>
          </button>
        </div>

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
          {/* Title, with the subtask breadcrumb stacked above it so a subtask
              row reads "↳ parent / this task" in both the wide and stacked
              layouts. */}
          <div className="flex min-w-0 flex-col gap-0.5">
            {isSubtask ? (
              <Link
                href={`/task/${task.parent_task_id}`}
                onClick={(e) => e.stopPropagation()}
                title={
                  parentTitle ? `Subtask of “${parentTitle}”` : "Subtask"
                }
                className="inline-flex w-fit max-w-full items-center gap-1 text-[11px] font-medium leading-none text-neutral-400 transition-colors hover:text-indigo-600 dark:text-neutral-500 dark:hover:text-indigo-400"
              >
                <SubtaskArrowIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{parentTitle ?? "Parent task"}</span>
              </Link>
            ) : null}
            <span
              className={`line-clamp-2 break-words text-sm leading-snug transition-colors ease-out motion-reduce:transition-none @lg:line-clamp-none ${
                completed
                  ? "text-neutral-400 line-through dark:text-neutral-600"
                  : "text-neutral-900 dark:text-neutral-100"
              }`}
              style={{ transitionDuration: `${TASK_COMPLETE_CHECK_MS}ms` }}
            >
              <LinkifiedText text={task.title} />
            </span>
          </div>

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

            {/* A completed task shows WHEN it was finished, not its (now
                irrelevant, usually "overdue") scheduled date — a neutral,
                non-editable chip. Falls back to "Today" between an optimistic
                completion and the refresh that stamps `completed_at`. */}
            {completed ? (
              <span
                className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 @lg:ml-auto dark:bg-neutral-800 dark:text-neutral-400"
                title={
                  task.completed_at
                    ? `Completed ${new Date(task.completed_at).toLocaleString()}`
                    : "Completed"
                }
              >
                {task.completed_at ? formatCompletedDate(task.completed_at) : "Today"}
              </span>
            ) : (
              /* Effective scheduling chip — clickable to reschedule inline
                 (do-date if set, else deadline). When a do-date and a distinct
                 deadline both exist, show the deadline as a static second chip.
                 `@lg:ml-auto` pushes the pair to the row's right edge on wide
                 containers, preserving the desktop layout. `shrink-0` is what
                 keeps that edge in the same place from row to row: the chips
                 inside refuse to shrink, so a shrinkable wrapper gets squeezed
                 narrower than its own contents on a long-title row and the
                 pill spills out past where `ml-auto` placed it — a date column
                 that wanders by a dozen-odd pixels.

                 Only this wrapper is pinned. The other chips have the same
                 shrinkable-box-around-unshrinkable-content shape, but they sit
                 inline after the title where nothing is claiming to be a
                 column, so their overflow costs nothing — and pinning them is
                 not free: on a row that is genuinely over capacity something
                 has to absorb the squeeze, and taking chips out of the pool
                 just moves the damage onto whatever is still flexible (the
                 project chip collapsing to a single letter, the title breaking
                 one character per line). */
              (scheduledDate || task.deadline_date) && (
                <div className="flex shrink-0 items-center gap-2 @lg:ml-auto">
                  <InlineScheduleEditor
                    scheduledDate={scheduledDate}
                    scheduledTime={scheduledTime}
                    deadlineDate={task.deadline_date}
                    deadlineTime={task.deadline_time}
                    onChange={handleScheduleChange}
                  />
                  {scheduledDate && task.deadline_date && scheduledDate !== task.deadline_date && (
                    <span
                      className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-950 dark:text-red-400"
                      title={`Hard deadline ${task.deadline_date}`}
                    >
                      by {formatTaskDate(task.deadline_date)}
                    </span>
                  )}
                </div>
              )
            )}
          </div>
        </div>

        {/* Always visible on touch (no hover); reveal on hover for pointer
            devices to keep the desktop list calm. Scoped to the row's own
            `group/row` so hovering one row never reveals a sibling's controls
            (an outer section may also be a `group`). */}
        <div
          className="flex shrink-0 gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover/row:opacity-100 md:focus-within:opacity-100"
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
            <ContextMenuPositioner anchor={menuPos}>
              <TaskContextMenu
                task={task}
                projects={allProjects}
                onEdit={() => setEditing(true)}
                onClose={() => setMenuPos(null)}
                onMutated={() => startTransition(() => router.refresh())}
              />
            </ContextMenuPositioner>
          </div>,
          document.body
        )}

      {bulkMenuPos &&
        createPortal(
          <div
            className="fixed inset-0 z-50"
            onClick={() => setBulkMenuPos(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setBulkMenuPos(null);
            }}
          >
            <ContextMenuPositioner anchor={bulkMenuPos}>
              <BulkActionMenu
                count={selection.count}
                projects={allProjects}
                onClose={() => setBulkMenuPos(null)}
              />
            </ContextMenuPositioner>
          </div>,
          document.body
        )}
    </>
  );
}
