"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Project } from "@do-done/shared";
import { useQuickAddComposer } from "@/lib/use-quick-add-composer";
import { useQuickAddContext } from "@/lib/quick-add-context";
import { seedFromPathname, type QuickAddSeed } from "@/lib/quick-add";
import {
  OPEN_QUICK_ADD_EVENT,
  type OpenQuickAddDetail,
} from "@/lib/quick-add-events";
import { useBackdropDismiss } from "@/lib/backdrop-dismiss";
import { ParsedPreview, QuickAddChipRow, SuggestedFacets } from "./quick-add-chips";
import { TaskEditModalV2 } from "./task-edit-modal-v2";

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

/**
 * The universal quick-add modal. Opened from the sidebar button, the command
 * palette, or the `q` shortcut. A single natural-language input plus the shared
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
  // A seed carried by the open event (a section's "add here"), when there is
  // one. Otherwise the modal takes the page's own context: it opens over
  // wherever the user already is, so `q` on a project page should file there
  // exactly as that page's own bar does.
  const [seedOverride, setSeedOverride] = useState<QuickAddSeed | null>(null);
  const pathname = usePathname();
  const routeSeed = useMemo(() => seedFromPathname(pathname), [pathname]);
  const seed = seedOverride ?? routeSeed;
  const composer = useQuickAddComposer(seed, { keepOpen: false });
  const { resetAll, reset, handoffTask } = composer;
  const { addProject } = useQuickAddContext();

  const [createdProjects, setCreatedProjects] = useState<Project[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const allProjects = useMemo(
    () => [...projects, ...createdProjects],
    [projects, createdProjects]
  );

  // Open via the global event (sidebar / palette), with an optional seed. Each
  // session starts fresh (reset at the open event, not in an effect).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenQuickAddDetail>).detail;
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      resetAll();
      setSeedOverride(detail?.seed ?? null);
      setOpen(true);
    };
    window.addEventListener(OPEN_QUICK_ADD_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_QUICK_ADD_EVENT, onOpen);
  }, [resetAll]);

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
      resetAll();
      setSeedOverride(null);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handoffTask, resetAll]);

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

  const backdrop = useBackdropDismiss<HTMLDivElement>(() => close());

  async function handleAdd() {
    const created = await composer.add();
    if (created) close();
  }

  async function handleMoreOptions() {
    // Create now, then open the full editor on the persisted task. `allowEmpty`
    // makes this a real door to the full editor rather than a reward for having
    // typed something: with nothing in the box it creates a throwaway "New task"
    // and the editor drops it again if closed untouched (see TaskEditModalV2's
    // `draft`), which is how the bar and the inline composer already behave.
    const created = await composer.openEditor({ allowEmpty: true });
    if (created) setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleAdd();
    } else if (e.key === "Tab" && !e.shiftKey && composer.acceptSuggestions()) {
      // Only when there was something to take; otherwise Tab still moves focus.
      e.preventDefault();
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
          {...backdrop}
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
                value={composer.input}
                onChange={(e) => composer.setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={composer.submitting}
                aria-label="Task title"
                placeholder="Add a task… (try: 'pay rent tomorrow p1 #home')"
                className="flex-1 bg-transparent text-base text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-50 dark:text-neutral-100 dark:placeholder:text-neutral-600"
              />
            </div>

            {composer.parsed && composer.parsed.title ? (
              <ParsedPreview
                parsed={composer.parsed}
                omitChipFields
                className="px-4 pb-1"
              />
            ) : null}
            <SuggestedFacets
              suggestions={composer.suggestions}
              projects={allProjects}
              onAcceptProject={composer.setProjectId}
              onAcceptDuration={composer.setDuration}
              className="px-4 pb-1"
            />

            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <QuickAddChipRow
                priority={composer.priority}
                setPriority={composer.setPriority}
                duration={composer.duration}
                setDuration={composer.setDuration}
                scheduledDate={composer.scheduledDate}
                setScheduledDate={composer.setScheduledDate}
                projectId={composer.projectId}
                setProjectId={composer.setProjectId}
                projects={allProjects}
                userId={userId}
                onCreatedProject={(p) => {
                  setCreatedProjects((prev) => [...prev, p]);
                  // Also register it with the provider, whose list is what the
                  // parse matches `#name` against — otherwise a project created
                  // here can't be typed by name until the next page load.
                  addProject(p);
                }}
              />
            </div>

            {composer.error ? (
              <div className="px-4 pb-2 text-xs text-red-500">
                {composer.error}
              </div>
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
                  disabled={!composer.input.trim() || composer.submitting}
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
          draft={composer.handoffIsDraft}
          onClose={() => {
            composer.clearHandoff();
            reset();
            requestAnimationFrame(() => restoreFocusRef.current?.focus?.());
          }}
        />
      ) : null}
    </>
  );
}
