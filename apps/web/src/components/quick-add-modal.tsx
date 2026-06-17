"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PRIORITY_CONFIG,
  addDaysLocalISO,
  type CreateTaskInput,
  type ParsedTask,
  type Project,
  type Task,
  type TaskPriority,
  type WhenBucket,
} from "@do-done/shared";
import { formatRrule } from "@do-done/task-engine";
import { useQuickAdd } from "@/lib/use-quick-add";
import type { QuickAddSeed } from "@/lib/quick-add";
import {
  OPEN_QUICK_ADD_EVENT,
  type OpenQuickAddDetail,
} from "@/lib/quick-add-events";
import {
  ESTIMATE_OPTIONS,
  PRIORITY_OPTIONS,
  PickerPopover,
  TaskEditModalV2,
  useClickOutside,
} from "./task-edit-modal-v2";
import { ProjectPickerPopover } from "./project-picker";

const PRIORITY_DOT: Record<TaskPriority, string> = {
  p1: "bg-red-500",
  p2: "bg-amber-500",
  p3: "bg-indigo-500",
  p4: "bg-neutral-400",
};

const BUCKET_LABEL: Record<string, string> = {
  this_week: "This week",
  next_week: "Next week",
  later: "Later",
  someday: "Someday",
};

function PlusIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={`${className} shrink-0`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" />
    </svg>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
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
      {children}
    </button>
  );
}

function PriorityChip({
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
      <ChipButton active={value != null} onClick={() => setOpen((o) => !o)}>
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

function EstimateChip({
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
      <ChipButton active={value != null} onClick={() => setOpen((o) => !o)}>
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

function WhenChip({
  whenDate,
  whenBucket,
  onChange,
}: {
  whenDate: string | null;
  whenBucket: WhenBucket | null;
  onChange: (next: { whenDate: string | null; whenBucket: WhenBucket | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const options = useMemo(() => {
    const today = addDaysLocalISO(0);
    const tomorrow = addDaysLocalISO(1);
    return [
      { key: "today", label: "Today", whenDate: today, whenBucket: null as WhenBucket | null },
      { key: "tomorrow", label: "Tomorrow", whenDate: tomorrow, whenBucket: null as WhenBucket | null },
      { key: "this_week", label: "This week", whenDate: null, whenBucket: "this_week" as WhenBucket },
      { key: "next_week", label: "Next week", whenDate: null, whenBucket: "next_week" as WhenBucket },
      { key: "later", label: "Later", whenDate: null, whenBucket: "later" as WhenBucket },
      { key: "someday", label: "Someday", whenDate: null, whenBucket: "someday" as WhenBucket },
      { key: "none", label: "No date", whenDate: null, whenBucket: null as WhenBucket | null },
    ];
  }, []);

  const label = whenDate
    ? whenDate === addDaysLocalISO(0)
      ? "Today"
      : whenDate === addDaysLocalISO(1)
        ? "Tomorrow"
        : whenDate
    : whenBucket
      ? BUCKET_LABEL[whenBucket]
      : "When";

  return (
    <div className="relative" ref={ref}>
      <ChipButton active={whenDate != null || whenBucket != null} onClick={() => setOpen((o) => !o)}>
        {label}
      </ChipButton>
      {open ? (
        <PickerPopover
          ariaLabel="When"
          onClose={() => setOpen(false)}
          options={options.map((o) => ({
            key: o.key,
            code: "",
            label: o.label,
            selected:
              o.key === "none"
                ? whenDate == null && whenBucket == null
                : (o.whenDate != null && o.whenDate === whenDate) ||
                  (o.whenBucket != null && o.whenBucket === whenBucket),
            onSelect: () => {
              onChange({ whenDate: o.whenDate, whenBucket: o.whenBucket });
              setOpen(false);
            },
            accentClass: "bg-indigo-500",
          }))}
        />
      ) : null}
    </div>
  );
}

function ProjectChip({
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
      <ChipButton active={selectedId != null} onClick={() => setOpen((o) => !o)}>
        {selected ? `${selected.icon ? `${selected.icon} ` : ""}${selected.name}` : "Project"}
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

/** Read-only preview of what the natural-language text parsed into, so the user
 *  sees the effective task before adding (covers fields the chips don't). */
function ParsedPreview({ parsed }: { parsed: ParsedTask }) {
  const chips: React.ReactNode[] = [];
  if (parsed.priority)
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
  if (parsed.when_date)
    chips.push(
      <span key="when" className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
        {parsed.when_date}
      </span>
    );
  if (parsed.when_bucket)
    chips.push(
      <span key="bucket" className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
        {BUCKET_LABEL[parsed.when_bucket] ?? parsed.when_bucket}
      </span>
    );
  if (parsed.due_date)
    chips.push(
      <span key="due" className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
        due {parsed.due_date}
        {parsed.due_time ? ` ${parsed.due_time}` : ""}
      </span>
    );
  parsed.tags?.forEach((tag) =>
    chips.push(
      <span key={`tag-${tag}`} className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
        #{tag}
      </span>
    )
  );
  if (parsed.duration_minutes)
    chips.push(
      <span key="dur" className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
        {parsed.duration_minutes}min
      </span>
    );
  if (parsed.recurrence_rule)
    chips.push(
      <span key="rec" className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-600 dark:bg-violet-950 dark:text-violet-400">
        {formatRrule(parsed.recurrence_rule)}
      </span>
    );
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-1 text-[11px] text-neutral-500">
      {chips}
    </div>
  );
}

/**
 * The universal quick-add modal. Opened from the sidebar button, the FAB, the
 * command palette, or the `q` shortcut. A single natural-language input plus
 * When / Priority / Project / Estimate chips; "More options" creates the task
 * and hands off to the full editor for everything else.
 */
export function QuickAddModal({
  projects,
  userId,
}: {
  projects: Project[];
  userId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<QuickAddSeed>({});
  const { input, setInput, parsed, submitting, error, submit, reset } =
    useQuickAdd(seed, { keepOpen: false });

  // Chip overrides — explicit selections that win over parsed text + seed.
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [whenDate, setWhenDate] = useState<string | null>(null);
  const [whenBucket, setWhenBucket] = useState<WhenBucket | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [createdProjects, setCreatedProjects] = useState<Project[]>([]);

  const [handoffTask, setHandoffTask] = useState<Task | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const allProjects = useMemo(
    () => [...projects, ...createdProjects],
    [projects, createdProjects]
  );

  // Clear the input + every chip. Called when opening so each session starts
  // fresh (done at the open event, not in an effect, to keep render pure).
  const resetForm = useCallback(() => {
    reset();
    setPriority(null);
    setDuration(null);
    setWhenDate(null);
    setWhenBucket(null);
    setProjectId(null);
  }, [reset]);

  // Open via the global event (sidebar / FAB / palette), with an optional seed.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenQuickAddDetail>).detail;
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      resetForm();
      setSeed(detail?.seed ?? {});
      setOpen(true);
    };
    window.addEventListener(OPEN_QUICK_ADD_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_QUICK_ADD_EVENT, onOpen);
  }, [resetForm]);

  // The "q" shortcut — only when nothing's already open and focus isn't in a
  // text field, and no modifier is held (so ⌘Q / ⌃Q stay native).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || handoffTask) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() !== "q") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      restoreFocusRef.current = t;
      resetForm();
      setSeed({});
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handoffTask, resetForm]);

  // Focus the input whenever the modal opens (a DOM side-effect, not state).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  function close() {
    setOpen(false);
    reset();
    requestAnimationFrame(() => restoreFocusRef.current?.focus?.());
  }

  function buildOverride(): Partial<CreateTaskInput> {
    return {
      ...(priority && { priority }),
      ...(duration && { duration_minutes: duration }),
      ...(projectId && { project_id: projectId }),
      ...(whenDate && { when_date: whenDate }),
      ...(whenBucket && { when_bucket: whenBucket }),
    };
  }

  async function handleAdd() {
    const created = await submit({ override: buildOverride() });
    if (created) close();
  }

  async function handleMoreOptions() {
    if (!input.trim()) {
      inputRef.current?.focus();
      return;
    }
    // Create now, then open the full editor on the persisted task.
    const created = await submit({ override: buildOverride(), skipRefresh: true });
    if (created) {
      setOpen(false);
      setHandoffTask(created);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleAdd();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[15vh]"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Quick add task"
            className="w-full max-w-xl rounded-xl bg-white shadow-2xl dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <span className="text-indigo-500">
                <PlusIcon />
              </span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={submitting}
                aria-label="Task title"
                placeholder="Add a task… (try: 'pay rent tomorrow p1 #home')"
                className="flex-1 bg-transparent text-base text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-50 dark:text-neutral-100 dark:placeholder:text-neutral-600"
              />
            </div>

            {parsed && parsed.title ? <ParsedPreview parsed={parsed} /> : null}

            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <WhenChip
                whenDate={whenDate}
                whenBucket={whenBucket}
                onChange={({ whenDate, whenBucket }) => {
                  setWhenDate(whenDate);
                  setWhenBucket(whenBucket);
                }}
              />
              <PriorityChip value={priority} onChange={setPriority} />
              {userId ? (
                <ProjectChip
                  projects={allProjects}
                  userId={userId}
                  selectedId={projectId}
                  onSelect={setProjectId}
                  onCreated={(p) => {
                    setCreatedProjects((prev) => [...prev, p]);
                    setProjectId(p.id);
                  }}
                />
              ) : null}
              <EstimateChip value={duration} onChange={setDuration} />
            </div>

            {error ? (
              <div className="px-4 pb-2 text-xs text-red-500">{error}</div>
            ) : null}

            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <button
                type="button"
                onClick={handleMoreOptions}
                className="text-xs font-medium text-neutral-500 transition-colors hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                More options →
              </button>
              <div className="flex items-center gap-3">
                <span className="hidden text-[10px] text-neutral-400 sm:inline">
                  <kbd className="font-mono">↵</kbd> add ·{" "}
                  <kbd className="font-mono">Esc</kbd> close
                </span>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!input.trim() || submitting}
                  className="rounded-lg bg-indigo-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add task
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {handoffTask ? (
        <TaskEditModalV2
          task={handoffTask}
          projects={allProjects}
          open
          onClose={() => {
            setHandoffTask(null);
            reset();
            requestAnimationFrame(() => restoreFocusRef.current?.focus?.());
          }}
        />
      ) : null}
    </>
  );
}
