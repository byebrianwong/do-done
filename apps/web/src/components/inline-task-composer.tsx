"use client";

import { useRef, useState } from "react";
import { PRIORITY_CONFIG, type ParsedTask } from "@do-done/shared";
import { formatRrule } from "@do-done/task-engine";
import { useQuickAdd } from "@/lib/use-quick-add";
import type { QuickAddSeed } from "@/lib/quick-add";

function PlusIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
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

/** Compact read-only preview of what the natural-language input parsed into. */
function ParsedChips({ parsed }: { parsed: ParsedTask }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-9 text-[11px] text-neutral-500">
      {parsed.priority && (
        <span
          className="rounded-full px-2 py-0.5 font-medium"
          style={{
            color: PRIORITY_CONFIG[parsed.priority].color,
            backgroundColor: PRIORITY_CONFIG[parsed.priority].color + "15",
          }}
        >
          {PRIORITY_CONFIG[parsed.priority].label}
        </span>
      )}
      {parsed.due_date && (
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
          {parsed.due_date}
          {parsed.due_time && ` ${parsed.due_time}`}
        </span>
      )}
      {parsed.tags?.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
        >
          #{tag}
        </span>
      ))}
      {parsed.duration_minutes && (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
          {parsed.duration_minutes}min
        </span>
      )}
      {parsed.recurrence_rule && (
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-600 dark:bg-violet-950 dark:text-violet-400">
          {formatRrule(parsed.recurrence_rule)}
        </span>
      )}
    </div>
  );
}

/**
 * A per-section inline quick-add. Collapsed it's a faint "Add task" affordance
 * (revealed on section hover or keyboard focus); expanded it's a
 * natural-language input pre-seeded with the section's context. Enter creates
 * and keeps the row open for rapid entry; Esc / empty-blur collapses it.
 *
 * The collapsed button is revealed by the nearest `group` ancestor's hover, so
 * wrap the section in a `group` class.
 */
export function InlineTaskComposer({
  seed,
  placeholder = "Add task…",
}: {
  seed: QuickAddSeed;
  placeholder?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { input, setInput, parsed, submitting, error, submit, reset } =
    useQuickAdd(seed, { keepOpen: true });

  function expand() {
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function collapse() {
    reset();
    setExpanded(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const created = await submit();
    // keepOpen cleared the input; refocus for the next task.
    if (created) requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      collapse();
    }
  }

  function handleBlur() {
    // Leaving an empty composer collapses it; mid-typing it stays open.
    if (!input.trim()) {
      reset();
      setExpanded(false);
    }
  }

  if (!expanded) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={expand}
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-neutral-400 opacity-0 transition-opacity hover:text-indigo-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-neutral-500 dark:hover:text-indigo-400"
      >
        <PlusIcon />
        Add task
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="py-1">
      <div className="flex items-center gap-2 rounded-md border border-indigo-300 bg-white px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-100 dark:border-indigo-700 dark:bg-neutral-900 dark:focus-within:ring-indigo-950">
        <span className="text-indigo-500">
          <PlusIcon />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={submitting}
          aria-label="Add a task"
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-50 dark:text-neutral-100 dark:placeholder:text-neutral-600"
        />
        <kbd className="hidden rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400 sm:inline dark:border-neutral-700 dark:bg-neutral-800">
          ↵
        </kbd>
      </div>
      {parsed && parsed.title && <ParsedChips parsed={parsed} />}
      {error && <div className="mt-1 pl-9 text-xs text-red-500">{error}</div>}
    </form>
  );
}
