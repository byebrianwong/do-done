"use client";

import { useEffect, useRef, useState } from "react";
import {
  PRIORITY_CONFIG,
  QUICK_SCHEDULE,
  resolveQuickSchedule,
} from "@do-done/shared";
import type {
  Task,
  Project,
  TaskPriority,
  UpdateTaskInput,
} from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { toCreateInput } from "@/lib/task-create-input";
import { isCopyLinkShortcut } from "@/lib/task-link";
import { useCopyTaskLink } from "@/lib/use-copy-task-link";
import { useUndoToast } from "./undo-toast";
import {
  PRIORITY_OPTIONS,
  ESTIMATE_OPTIONS,
  estimateBarIndex,
} from "./task-edit-modal-v2";

export interface TaskContextMenuProps {
  task: Task;
  projects?: Project[];
  /** Open the full edit modal — the menu can't own the modal, so the row does. */
  onEdit: () => void;
  /** Close the menu (after a decisive pick, Escape, or an outside click). */
  onClose: () => void;
  /** Called after any successful mutation so the row can `router.refresh()`. */
  onMutated?: () => void;
}

// ── Icons ─────────────────────────────────────────────
// Hand-drawn to match the rest of the web app (no icon library). 16px,
// 24-unit viewBox, inherits `currentColor` from the row.

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      className={className ?? "h-4 w-4"}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICON = {
  edit: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z",
  flame: "M12 3c.5 3.5 4 4.5 4 8a4 4 0 11-8 0c0-1.2.5-2.2 1.2-3 .3 1 .9 1.6 1.8 1.8C10.5 7.5 10.8 5 12 3z",
  folder: "M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  link: "M10 14a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1 1M14 10a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1-1",
  trash: "M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m-1 0v12a1 1 0 01-1 1H9a1 1 0 01-1-1V7",
  chevron: "M9 5l7 7-7 7",
} as const;

function TargetIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
    </svg>
  );
}

function FlagIcon({ color, filled }: { color: string; filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path d="M6 21V4" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <path
        d="M6 4.5h10.5l-2.2 3.4 2.2 3.4H6z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Building blocks ───────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
      {children}
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />;
}

function MenuRow({
  icon,
  label,
  shortcut,
  danger,
  expandable,
  expanded,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  danger?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-expanded={expandable ? !!expanded : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
        danger
          ? "text-red-600 dark:text-red-400"
          : "text-neutral-800 dark:text-neutral-100"
      }`}
    >
      <span
        className={`shrink-0 ${
          danger
            ? "text-red-500 dark:text-red-400"
            : "text-neutral-400 dark:text-neutral-500"
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {shortcut ? (
        <kbd className="shrink-0 font-sans text-[11px] font-normal text-neutral-400 dark:text-neutral-500">
          {shortcut}
        </kbd>
      ) : null}
      {expandable ? (
        <span
          className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${
            expanded ? "rotate-90" : ""
          }`}
        >
          <Icon d={ICON.chevron} className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </button>
  );
}

const PILL_BASE =
  "rounded-md px-2 py-1 text-xs font-medium transition-colors";
function pillClass(selected: boolean) {
  return selected
    ? `${PILL_BASE} bg-indigo-500 text-white`
    : `${PILL_BASE} bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700`;
}

const DATE_INPUT_CLASS =
  "w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-[13px] text-neutral-800 outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200";

/**
 * Right-click context menu for a task row — the "Refined classic" concept:
 * Todoist's structure (Edit · Schedule · Priority · Estimate · Focus · …) in
 * DoDone's design language. Self-contained: it owns optimistic state and writes
 * through `getClientTasksApi`, mirroring ScheduleButton and the inline editors.
 */
export function TaskContextMenu({
  task,
  projects = [],
  onEdit,
  onClose,
  onMutated,
}: TaskContextMenuProps) {
  const toast = useUndoToast();
  const copyLinkFor = useCopyTaskLink();

  // Optimistic copies so highlights update instantly before the refresh lands.
  const [priority, setPriority] = useState(task.priority);
  const [duration, setDuration] = useState(task.duration_minutes);
  const [scheduledDate, setScheduledDate] = useState(task.scheduled_date);
  const [deadlineDate, setDeadlineDate] = useState(task.deadline_date);
  const [projectId, setProjectId] = useState(task.project_id);
  const [focus, setFocus] = useState(task.focus_override);

  // Which expandable section is open (only one at a time keeps the menu short).
  const [section, setSection] = useState<"deadline" | "move" | null>(null);

  // Esc closes; ⇧⌘C makes good on the shortcut the "Copy link" row advertises.
  // Both are scoped to the menu, which only exists while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (isCopyLinkShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        void copyLinkFor(task.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, copyLinkFor, task.id]);

  async function mutate(patch: UpdateTaskInput) {
    try {
      const tasks = await getClientTasksApi();
      const { error } = await tasks.update(task.id, patch);
      if (error) {
        console.error("Context menu update failed:", error);
        return;
      }
      onMutated?.();
    } catch (e) {
      console.error("Context menu update failed:", e);
    }
  }

  function pickPriority(p: TaskPriority) {
    // Picking the priority a task already has clears it back to p4 — the
    // "no priority" default, same toggle the editor's priority bars use.
    const next = p === priority ? "p4" : p;
    setPriority(next);
    void mutate({ priority: next });
    onClose();
  }

  function pickScheduledDate(date: string) {
    setScheduledDate(date);
    void mutate({ scheduled_date: date });
    onClose();
  }

  function setScheduledDateLoose(date: string | null) {
    setScheduledDate(date);
    void mutate({ scheduled_date: date, ...(date ? {} : { scheduled_time: null }) });
  }

  function pickEstimate(minutes: number) {
    setDuration(minutes);
    void mutate({ duration_minutes: minutes });
    onClose();
  }

  function clearEstimate() {
    setDuration(null);
    void mutate({ duration_minutes: null });
  }

  function setDeadline(date: string | null) {
    setDeadlineDate(date);
    void mutate({ deadline_date: date, ...(date ? {} : { deadline_time: null }) });
  }

  function pickProject(id: string | null) {
    setProjectId(id);
    void mutate({ project_id: id });
    onClose();
  }

  function toggleFocus() {
    const next = focus === "include" ? null : "include";
    setFocus(next);
    void mutate({ focus_override: next });
    onClose();
  }

  async function duplicate() {
    onClose();
    try {
      const tasks = await getClientTasksApi();
      await tasks.create(toCreateInput(task, `${task.title} (copy)`));
      onMutated?.();
    } catch (e) {
      console.error("Duplicate failed:", e);
    }
  }

  async function copyLink() {
    onClose();
    await copyLinkFor(task.id);
  }

  async function remove() {
    onClose();
    try {
      const tasks = await getClientTasksApi();
      const { error } = await tasks.delete(task.id);
      if (error) {
        console.error("Delete failed:", error);
        return;
      }
      onMutated?.();
      toast.show({
        message: `Deleted “${task.title}”`,
        undo: async () => {
          const api = await getClientTasksApi();
          await api.create(toCreateInput(task, task.title));
          onMutated?.();
        },
      });
    } catch (e) {
      console.error("Delete failed:", e);
    }
  }

  const activeEstimate = estimateBarIndex(duration);
  const isPinned = focus === "include";

  return (
    <div
      role="menu"
      aria-label={`Actions for ${task.title}`}
      className="w-64 select-none overflow-hidden rounded-xl border border-neutral-200 bg-white p-1.5 text-[13px] shadow-[0_12px_28px_rgba(17,24,39,0.14),0_3px_8px_rgba(17,24,39,0.08)] dark:border-neutral-800 dark:bg-neutral-950"
    >
      <MenuRow
        icon={<Icon d={ICON.edit} />}
        label="Edit"
        shortcut="⌘E"
        onClick={() => {
          onClose();
          onEdit();
        }}
      />

      <SectionLabel>Schedule</SectionLabel>
      <div className="flex flex-wrap gap-1 px-1.5">
        {QUICK_SCHEDULE.map((q) => {
          const date = resolveQuickSchedule(q.key);
          return (
            <button
              key={q.key}
              type="button"
              role="menuitem"
              onClick={() => pickScheduledDate(date)}
              className={pillClass(scheduledDate === date)}
            >
              {q.label}
            </button>
          );
        })}
      </div>
      <div className="mt-1 px-1.5">
        <input
          type="date"
          aria-label="Pick a do-date"
          value={scheduledDate ?? ""}
          onChange={(e) => setScheduledDateLoose(e.target.value || null)}
          className={DATE_INPUT_CLASS}
        />
      </div>
      {scheduledDate ? (
        <div className="px-1.5">
          <button
            type="button"
            onClick={() => setScheduledDateLoose(null)}
            className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            × Clear schedule
          </button>
        </div>
      ) : null}

      <SectionLabel>Priority</SectionLabel>
      <div className="flex gap-1 px-1.5">
        {PRIORITY_OPTIONS.map((p) => {
          const selected = priority === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="menuitem"
              title={`${p.code} · ${p.label}`}
              aria-label={`${p.code} ${p.label}`}
              onClick={() => pickPriority(p.value)}
              className={`flex h-8 flex-1 items-center justify-center rounded-md border transition-colors ${
                selected
                  ? "border-transparent bg-indigo-50 ring-1 ring-inset ring-indigo-400 dark:bg-indigo-950/50 dark:ring-indigo-500"
                  : "border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800"
              }`}
            >
              <FlagIcon
                color={PRIORITY_CONFIG[p.value].color}
                filled={p.value !== "p4"}
              />
            </button>
          );
        })}
      </div>

      <SectionLabel>Estimate</SectionLabel>
      <div className="flex flex-wrap gap-1 px-1.5">
        {ESTIMATE_OPTIONS.map((opt, i) => (
          <button
            key={opt.minutes}
            type="button"
            role="menuitem"
            title={opt.label}
            onClick={() => pickEstimate(opt.minutes)}
            className={pillClass(i === activeEstimate)}
          >
            {opt.short}
          </button>
        ))}
      </div>
      {duration ? (
        <div className="px-1.5">
          <button
            type="button"
            onClick={clearEstimate}
            className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            × Clear estimate
          </button>
        </div>
      ) : null}

      <Divider />

      <MenuRow
        icon={<TargetIcon />}
        label={isPinned ? "Remove from Focus" : "Add to Focus"}
        shortcut="⌘F"
        onClick={toggleFocus}
      />
      <MenuRow
        icon={<Icon d={ICON.flame} />}
        label="Deadline"
        expandable
        expanded={section === "deadline"}
        onClick={() =>
          setSection((s) => (s === "deadline" ? null : "deadline"))
        }
      />
      {section === "deadline" ? (
        <div className="px-1.5 pb-1 pt-0.5">
          <input
            type="date"
            aria-label="Pick a deadline"
            value={deadlineDate ?? ""}
            onChange={(e) => setDeadline(e.target.value || null)}
            className={DATE_INPUT_CLASS}
          />
          {deadlineDate ? (
            <button
              type="button"
              onClick={() => setDeadline(null)}
              className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              × Clear deadline
            </button>
          ) : null}
        </div>
      ) : null}

      <Divider />

      <MenuRow
        icon={<Icon d={ICON.folder} />}
        label="Move to…"
        expandable
        expanded={section === "move"}
        onClick={() => setSection((s) => (s === "move" ? null : "move"))}
      />
      {section === "move" ? (
        <div className="max-h-44 space-y-0.5 overflow-y-auto px-1.5 pb-1">
          <button
            type="button"
            role="menuitem"
            onClick={() => pickProject(null)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
              projectId === null
                ? "text-indigo-600 dark:text-indigo-400"
                : "text-neutral-700 dark:text-neutral-300"
            }`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full border border-neutral-300 dark:border-neutral-600" />
            <span className="flex-1 truncate">No project</span>
            {projectId === null ? <span aria-hidden>✓</span> : null}
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              onClick={() => pickProject(p.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
                projectId === p.id
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-neutral-700 dark:text-neutral-300"
              }`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="flex-1 truncate">{p.name}</span>
              {projectId === p.id ? <span aria-hidden>✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <MenuRow icon={<CopyIcon />} label="Duplicate" onClick={duplicate} />
      <MenuRow
        icon={<Icon d={ICON.link} />}
        label="Copy link"
        shortcut="⇧⌘C"
        onClick={copyLink}
      />

      <Divider />

      <MenuRow
        icon={<Icon d={ICON.trash} />}
        label="Delete"
        shortcut="⌫"
        danger
        onClick={remove}
      />
    </div>
  );
}
