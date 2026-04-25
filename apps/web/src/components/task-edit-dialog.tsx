"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PRIORITY_CONFIG } from "@do-done/shared";
import type {
  Task,
  TaskPriority,
  TaskStatus,
  Project,
} from "@do-done/shared";
import { formatRrule } from "@do-done/task-engine";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";

interface TaskEditDialogProps {
  task: Task;
  projects?: Project[];
  open: boolean;
  onClose: () => void;
}

const PRIORITIES: TaskPriority[] = ["p1", "p2", "p3", "p4"];
const STATUSES: TaskStatus[] = [
  "inbox",
  "todo",
  "in_progress",
  "done",
  "archived",
];

export function TaskEditDialog({
  task,
  projects = [],
  open,
  onClose,
}: TaskEditDialogProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [projectId, setProjectId] = useState<string>(task.project_id ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [dueTime, setDueTime] = useState(task.due_time ?? "");
  const [duration, setDuration] = useState(
    task.duration_minutes?.toString() ?? ""
  );
  const [tagsInput, setTagsInput] = useState((task.tags ?? []).join(", "));
  const [recurrenceRule, setRecurrenceRule] = useState(
    task.recurrence_rule ?? ""
  );

  // Reset form when task changes
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setProjectId(task.project_id ?? "");
    setDueDate(task.due_date ?? "");
    setDueTime(task.due_time ?? "");
    setDuration(task.duration_minutes?.toString() ?? "");
    setTagsInput((task.tags ?? []).join(", "));
    setRecurrenceRule(task.recurrence_rule ?? "");
    setError(null);
  }, [task]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);

    const tasks = await getClientTasksApi();
    const { error } = await tasks.update(task.id, {
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      project_id: projectId || null,
      due_date: dueDate || null,
      due_time: dueTime || null,
      duration_minutes: duration ? parseInt(duration, 10) : null,
      recurrence_rule: recurrenceRule || null,
      tags,
    });

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }

    onClose();
    startTransition(() => router.refresh());
  }

  async function handleDelete() {
    if (!confirm("Archive this task?")) return;
    const tasks = await getClientTasksApi();
    await tasks.update(task.id, { status: "archived" });
    onClose();
    startTransition(() => router.refresh());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Edit task
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            aria-label="Close"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                style={{ borderLeftColor: PRIORITY_CONFIG[priority].color, borderLeftWidth: 4 }}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()} — {PRIORITY_CONFIG[p].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {projects.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500">
                Project
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500">
                Due date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500">
                Time
              </label>
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Duration (minutes)
            </label>
            <input
              type="number"
              min="1"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Tags{" "}
              <span className="font-normal text-neutral-400">
                (comma-separated)
              </span>
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="work, urgent"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Recurrence
              {recurrenceRule && (
                <span className="ml-2 font-normal text-violet-500">
                  · {formatRrule(recurrenceRule)}
                </span>
              )}
            </label>
            <input
              type="text"
              value={recurrenceRule}
              onChange={(e) => setRecurrenceRule(e.target.value)}
              placeholder="FREQ=WEEKLY;BYDAY=MO"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950">
          <button
            onClick={handleDelete}
            className="text-xs font-medium text-red-500 hover:text-red-600"
          >
            Archive
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="rounded-md bg-indigo-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
