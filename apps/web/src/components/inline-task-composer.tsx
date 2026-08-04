"use client";

import { useRef, useState } from "react";
import { useQuickAddComposer } from "@/lib/use-quick-add-composer";
import { useQuickAddContext } from "@/lib/quick-add-context";
import type { QuickAddSeed } from "@/lib/quick-add";
import { ParsedPreview, QuickAddChipRow } from "./quick-add-chips";
import { TaskEditModalV2 } from "./task-edit-modal-v2";

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

function ExpandIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 20.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
      />
    </svg>
  );
}

/**
 * A per-section inline quick-add. Collapsed it's a faint "Add task" affordance
 * (revealed on section hover or keyboard focus); expanded it's a
 * natural-language input pre-seeded with the section's context, plus the shared
 * When / Priority / Project / Estimate chips and an expand-to-editor button.
 * Enter creates and keeps the row open for rapid entry; Esc / empty-blur
 * collapses it.
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
  const ctx = useQuickAddContext();
  const composer = useQuickAddComposer(seed, { keepOpen: true });
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function expand() {
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function collapse(focusButton: boolean) {
    composer.resetAll();
    setExpanded(false);
    if (focusButton) requestAnimationFrame(() => buttonRef.current?.focus());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const created = await composer.add();
    // keepOpen cleared the input; refocus for the next task.
    if (created) {
      composer.resetChips();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function handleExpand() {
    // Open the full editor even with an empty composer — it creates a fresh
    // draft to edit (dropped again if closed untouched).
    await composer.openEditor({ allowEmpty: true });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      collapse(true);
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLFormElement>) {
    // Stay open while focus is anywhere inside the composer (input, a chip, an
    // open popover). Leaving an empty composer with no chips set collapses it.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (!composer.input.trim() && !composer.anyChipSet) {
      collapse(false);
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
    <>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onBlur={handleBlur}
        className="py-1"
      >
        <div className="rounded-md border border-indigo-300 bg-white px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-100 dark:border-indigo-700 dark:bg-neutral-900 dark:focus-within:ring-indigo-950">
          <div className="flex items-center gap-2">
            <span className="text-indigo-500">
              <PlusIcon />
            </span>
            <input
              ref={inputRef}
              type="text"
              value={composer.input}
              onChange={(e) => composer.setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={composer.submitting}
              aria-label="Add a task"
              placeholder={placeholder}
              className="flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-50 dark:text-neutral-100 dark:placeholder:text-neutral-600"
            />
            <button
              type="button"
              onClick={handleExpand}
              aria-label="Open full editor"
              title="More options"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-indigo-600 dark:hover:bg-neutral-800 dark:hover:text-indigo-400"
            >
              <ExpandIcon />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            <QuickAddChipRow
              priority={composer.priority}
              setPriority={composer.setPriority}
              duration={composer.duration}
              setDuration={composer.setDuration}
              scheduledDate={composer.scheduledDate}
              setScheduledDate={composer.setScheduledDate}
              projectId={composer.projectId}
              setProjectId={composer.setProjectId}
              projects={ctx.projects}
              userId={ctx.userId}
              onCreatedProject={ctx.addProject}
            />
          </div>
          {composer.parsed && composer.parsed.title ? (
            <ParsedPreview
              parsed={composer.parsed}
              omitChipFields
              className="mt-1.5"
            />
          ) : null}
        </div>
        {composer.error ? (
          <div className="mt-1 pl-9 text-xs text-red-500">{composer.error}</div>
        ) : null}
      </form>

      {composer.handoffTask ? (
        <TaskEditModalV2
          task={composer.handoffTask}
          projects={ctx.projects}
          open
          draft={composer.handoffIsDraft}
          onClose={() => {
            composer.clearHandoff();
            collapse(false);
          }}
        />
      ) : null}
    </>
  );
}
