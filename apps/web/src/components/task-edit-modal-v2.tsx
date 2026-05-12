"use client";

/**
 * Task edit modal V2 — round-7 design.
 * See docs/task-input-design/round7-desktop.html for the visual reference.
 *
 * Replaces task-edit-dialog.tsx via task-item.tsx swap. The old dialog is
 * kept in the codebase as a fallback until V2 is verified across all flows.
 *
 * Sub-components (PrioritySignal, EstimateEqualizer, etc.) are defined
 * inline in this file for the first ship. They can be extracted later if
 * other screens want to reuse them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PRIORITY_CONFIG,
  type Task,
  type TaskPriority,
  type WhenBucket,
} from "@do-done/shared";
import {
  useAutoSaveTask,
  TasksApi,
  type DayBusyness,
} from "@do-done/api-client";
import { createClientSupabase } from "@/lib/supabase/client";

// ─── Constants ─────────────────────────────────────────────

const PRIORITIES: TaskPriority[] = ["p1", "p2", "p3", "p4"];

const ESTIMATE_BUCKETS: { minutes: number; label: string }[] = [
  { minutes: 30, label: "≤30m" },
  { minutes: 60, label: "1h" },
  { minutes: 120, label: "2h" },
  { minutes: 240, label: "4h" },
  { minutes: 480, label: "8h" },
  { minutes: 960, label: "≥16h" },
];

// Map minutes → bar index for display.
function estimateBarIndex(minutes: number | null): number {
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

function PrioritySignal({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
}) {
  // p1 = 4 lit bars, p2 = 3, p3 = 2, p4 = 1
  const litCount = { p1: 4, p2: 3, p3: 2, p4: 1 }[value];
  const colorClass = {
    p1: "bg-red-500",
    p2: "bg-amber-500",
    p3: "bg-indigo-500",
    p4: "bg-neutral-400",
  }[value];
  const heights = ["h-[5px]", "h-[9px]", "h-[13px]", "h-[17px]"];
  return (
    <div className="inline-flex items-end gap-[2px]" role="radiogroup" aria-label="Priority">
      {[0, 1, 2, 3].map((i) => {
        const p = (["p4", "p3", "p2", "p1"] as TaskPriority[])[i];
        const lit = i < litCount;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(p)}
            aria-label={`Set priority ${PRIORITY_CONFIG[p].label}`}
            aria-pressed={value === p}
            className={`w-[4px] rounded-[1.5px] transition-colors hover:bg-neutral-300 dark:hover:bg-neutral-700 ${heights[i]} ${
              lit ? colorClass : "bg-neutral-200 dark:bg-neutral-800"
            }`}
          />
        );
      })}
    </div>
  );
}

function EstimateEqualizer({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (minutes: number) => void;
}) {
  const activeIdx = estimateBarIndex(value);
  const heights = ["h-[4px]", "h-[7px]", "h-[10px]", "h-[13px]", "h-[16px]", "h-[18px]"];
  return (
    <div className="inline-flex items-end gap-[2px]" role="radiogroup" aria-label="Estimate">
      {ESTIMATE_BUCKETS.map((b, i) => {
        const lit = i <= activeIdx;
        return (
          <button
            key={b.minutes}
            type="button"
            onClick={() => onChange(b.minutes)}
            title={b.label}
            aria-label={`Set estimate to ${b.label}`}
            aria-pressed={i === activeIdx}
            className={`w-[4px] rounded-[1.5px] transition-colors hover:bg-neutral-300 dark:hover:bg-neutral-700 ${heights[i]} ${
              lit
                ? "bg-indigo-500"
                : "bg-neutral-200 dark:bg-neutral-800"
            }`}
          />
        );
      })}
    </div>
  );
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

function WhenCalendar({
  whenDate,
  whenBucket,
  busyness,
  onPickDate,
  onPickBucket,
}: {
  whenDate: string | null;
  whenBucket: WhenBucket | null;
  busyness: DayBusyness[];
  onPickDate: (date: string) => void;
  onPickBucket: (bucket: WhenBucket | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const weekStart = useMemo(() => startOfWeek(today), [today]);
  const todayStr = ymd(today);

  // Build cells: 7 for week 1, 7 for week 2 if expanded.
  const cells = useMemo(() => {
    const out: { date: string; weekday: number; weekIdx: number }[] = [];
    const weeks = expanded ? 2 : 1;
    for (let w = 0; w < weeks; w++) {
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + w * 7 + i);
        out.push({ date: ymd(d), weekday: i, weekIdx: w });
      }
    }
    return out;
  }, [weekStart, expanded]);

  // Lookup busyness by date.
  const busyByDate = useMemo(() => {
    const m = new Map<string, DayBusyness>();
    for (const d of busyness) m.set(d.date, d);
    return m;
  }, [busyness]);

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
      {/* Cells */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => {
          const isWeekend = c.weekday === 0 || c.weekday === 6;
          const isPast = c.date < todayStr;
          const isToday = c.date === todayStr;
          const isActive = whenDate === c.date;
          const numLabel = parseInt(c.date.split("-")[2], 10);
          const day = busyByDate.get(c.date);
          const dots = (day?.items ?? []).slice(0, 8); // soft cap
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
                    ? "border-indigo-500 bg-indigo-50 shadow-md shadow-indigo-500/25 dark:bg-indigo-950/40"
                    : isToday
                      ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
                      : isWeekend
                        ? "border-transparent bg-indigo-500/[0.035] hover:border-neutral-200 hover:bg-white dark:hover:bg-neutral-900"
                        : "border-transparent bg-neutral-50 hover:border-neutral-200 hover:bg-white dark:bg-neutral-900/50 dark:hover:bg-neutral-900"
              }`}
            >
              {isToday && (
                <span className="absolute top-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-indigo-500" />
              )}
              <span
                className={`text-sm font-semibold leading-none ${
                  isActive
                    ? "text-indigo-700 dark:text-indigo-300"
                    : "text-neutral-900 dark:text-neutral-100"
                }`}
              >
                {numLabel}
              </span>
              {(isToday || isActive) && (
                <span
                  className={`mt-0.5 text-[9px] font-medium leading-none tracking-wider ${
                    isActive
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-neutral-400"
                  }`}
                >
                  {isActive ? "selected" : "today"}
                </span>
              )}
              <div className="mt-auto flex w-full flex-wrap items-end justify-center gap-[2px] pb-0.5 min-h-[14px]">
                {dots.map((item) => (
                  <span
                    key={item.id}
                    title={`${item.title} · ${item.duration_minutes}m`}
                    className={`h-[5px] rounded-[2.5px] ${busyDotClass(item)} ${busyDotWidthClass(item.duration_minutes)}`}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Alt-row: expand + buckets */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex-1 rounded-lg bg-indigo-50 px-2 py-2 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300"
          >
            + next week ⇣
          </button>
        )}
        {(["later", "someday"] as const).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => onPickBucket(whenBucket === b ? null : b)}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              whenBucket === b
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                : "bg-neutral-50 text-neutral-700 hover:bg-white hover:ring-1 hover:ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {b === "later" ? "⏳ Later" : "∞ Someday"}
          </button>
        ))}
      </div>
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

// Extract whitespace-terminated `#tag` tokens from text. Partial (unterminated)
// `#word` is left alone so the user can keep typing.
function extractCompletedTags(text: string): {
  stripped: string;
  tags: string[];
} {
  const tags: string[] = [];
  const re = /#(\w+)(\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tags.push(m[1]);
  }
  if (tags.length === 0) return { stripped: text, tags };
  // Replace each match with a single space, then collapse double spaces.
  const stripped = text.replace(/#(\w+)\s+/g, " ").replace(/\s{2,}/g, " ");
  return { stripped, tags };
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
  open: boolean;
  onClose: () => void;
}

export function TaskEditModalV2({ task, open, onClose }: TaskEditModalV2Props) {
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

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
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
  }, [open, handleClose, setField]);

  if (!open) return null;

  const onPickDate = (date: string) => {
    setField("when_date", date);
    setField("when_bucket", null);
  };
  const onPickBucket = (bucket: WhenBucket | null) => {
    setField("when_bucket", bucket);
    if (bucket !== null) setField("when_date", null);
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
    const { stripped, tags: extracted } = extractCompletedTags(v);
    if (extracted.length > 0) {
      const existing = new Set(current.tags);
      const fresh = extracted.filter((t) => !existing.has(t));
      if (fresh.length > 0) setField("tags", [...current.tags, ...fresh]);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/30 p-6 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-[640px] max-w-full overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(17,24,39,0.10),0_4px_12px_rgba(17,24,39,0.04)] dark:bg-neutral-950"
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
            {hasChanges && (
              <button
                type="button"
                onClick={undoAll}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
              >
                <span>↶</span>Undo all changes
              </button>
            )}
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
                  : current.when_bucket
                    ? current.when_bucket.replace("_", " ")
                    : "Not scheduled"}
              </span>
            </div>
            <WhenCalendar
              whenDate={current.when_date}
              whenBucket={current.when_bucket}
              busyness={busyness}
              onPickDate={onPickDate}
              onPickBucket={onPickBucket}
            />
          </div>

          {/* Inline meta */}
          <div className="flex flex-wrap items-center gap-3 border-y border-neutral-100 py-2.5 dark:border-neutral-900">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                Pri
              </span>
              <PrioritySignal
                value={current.priority}
                onChange={(p) => setField("priority", p)}
              />
              <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                {PRIORITY_CONFIG[current.priority].label}
              </span>
            </div>
            <div className="border-l border-neutral-100 pl-3 dark:border-neutral-800" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                Est
              </span>
              <EstimateEqualizer
                value={current.duration_minutes}
                onChange={(m) => setField("duration_minutes", m)}
              />
              <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">
                {current.duration_minutes
                  ? current.duration_minutes >= 60
                    ? `${Math.round(current.duration_minutes / 60)}h`
                    : `${current.duration_minutes}m`
                  : "—"}
              </span>
            </div>
          </div>

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

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-neutral-900 dark:bg-neutral-900/50">
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
            <Kbd>1</Kbd>-<Kbd>4</Kbd>
            <span className="mx-1">priority</span>
            <Kbd>Esc</Kbd>
            <span className="mx-1">close</span>
          </div>
          <DoneButton onClick={handleClose} />
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
