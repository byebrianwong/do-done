"use client";

import { useRef, useState } from "react";
import { useQuickAddComposer } from "@/lib/use-quick-add-composer";
import { useQuickAddContext } from "@/lib/quick-add-context";
import type { QuickAddSeed } from "@/lib/quick-add";
import { ParsedPreview, QuickAddChipRow, SuggestedFacets } from "./quick-add-chips";
import { TaskEditModalV2 } from "./task-edit-modal-v2";

function PlusIcon() {
  return (
    <svg
      className="h-5 w-5 shrink-0"
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
      className="h-4 w-4"
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
 * The top-of-page quick-add. Idle it's a single clean line; focusing reveals
 * the When / Priority / Project / Estimate chips, an Add button, and an expand
 * affordance that creates the task and opens the full editor for complete
 * control. Natural-language parsing still applies; a slim preview echoes the
 * fields the chips don't cover (deadline, tags, recurrence).
 *
 * `projects` / `userId` come from {@link useQuickAddContext}; `seed` carries the
 * page's context (status, and a project on a project page).
 */
export function QuickAddBar({
  seed = {},
  placeholder = "Add a task",
}: {
  seed?: QuickAddSeed;
  placeholder?: string;
}) {
  const ctx = useQuickAddContext();
  const composer = useQuickAddComposer(seed, { keepOpen: true });
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  const expanded =
    focused || composer.input.trim().length > 0 || composer.anyChipSet;

  function handleBlur(e: React.FocusEvent<HTMLFormElement>) {
    // Collapse only when focus leaves the whole bar (not when it moves between
    // the input, a chip, or an open popover — all live inside the form).
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setFocused(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const created = await composer.add();
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

  return (
    <div className="mb-6">
      <form
        onSubmit={handleSubmit}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        className={`rounded-xl border bg-white shadow-sm transition-colors dark:bg-neutral-900 ${
          expanded
            ? "border-indigo-300 ring-2 ring-indigo-100 dark:border-indigo-700 dark:ring-indigo-950"
            : "border-neutral-200 dark:border-neutral-800"
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 py-3">
          {/*
            A plus that focuses the field, not a decoration.

            The list composer's plus slides to the trailing edge and becomes a
            return key, because nothing else there commits. This bar cannot do
            that: focusing it expands the form, and the expanded form grows its
            own "Add task" button a few pixels below. A return key here would be
            a second commit control beside the real one. So the plus keeps its
            promise the other way — click it and you are typing, which is what
            starting an add means.
          */}
          <button
            type="button"
            onClick={() => inputRef.current?.focus()}
            // Hidden from the tab order and from screen readers, because it
            // does nothing the field beside it does not already do: a keyboard
            // reaches the input directly, and a second control announcing "Add
            // a task" next to the input of the same name is noise. This is a
            // pointer convenience, which is the one audience it has.
            tabIndex={-1}
            aria-hidden
            className="shrink-0 rounded text-indigo-500 transition-colors hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            <PlusIcon />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={composer.input}
            onChange={(e) => composer.setInput(e.target.value)}
            onKeyDown={(e) => {
              // Tab takes the offered guesses, and only when there are any —
              // otherwise it has to keep moving focus, which is what Tab means
              // everywhere else on this form.
              if (e.key === "Tab" && !e.shiftKey && composer.acceptSuggestions())
                e.preventDefault();
            }}
            disabled={composer.submitting}
            aria-label="Add a task"
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-50 dark:text-neutral-100 dark:placeholder:text-neutral-600"
          />
          {expanded ? (
            <button
              type="button"
              onClick={handleExpand}
              aria-label="Open full editor"
              title="More options"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-indigo-600 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-indigo-400"
            >
              <ExpandIcon />
            </button>
          ) : null}
        </div>

        {expanded ? (
          <>
            {composer.parsed && composer.parsed.title ? (
              <ParsedPreview
                parsed={composer.parsed}
                omitChipFields
                className="px-4 pb-1"
              />
            ) : null}
            <SuggestedFacets
              suggestions={composer.suggestions}
              projects={ctx.projects}
              onAcceptProject={composer.setProjectId}
              onAcceptDuration={composer.setDuration}
              className="px-4 pb-1"
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
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
              <button
                type="submit"
                disabled={!composer.input.trim() || composer.submitting}
                className="ml-auto rounded-lg bg-indigo-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add task
              </button>
            </div>
            {composer.error ? (
              <div className="px-4 pb-2 text-xs text-red-500">
                {composer.error}
              </div>
            ) : null}
          </>
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
            composer.resetAll();
            setFocused(false);
          }}
        />
      ) : null}
    </div>
  );
}
