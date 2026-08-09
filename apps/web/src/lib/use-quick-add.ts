"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseTaskInput } from "@do-done/task-engine";
import type { ParsedTask, Task } from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import {
  applyOverride,
  buildCreateInput,
  type QuickAddOverride,
  type QuickAddSeed,
} from "./quick-add";
import { useQuickAddContext } from "./quick-add-context";

export interface UseQuickAddOptions {
  /** After a successful create, clear the input for rapid multi-add instead of
   *  expecting the caller to unmount. */
  keepOpen?: boolean;
}

export interface QuickAddSubmitOptions {
  /** Explicit chip picks that win over the parsed text + seed; a `null` value
   *  clears the field the seed or the text would otherwise have set. */
  override?: QuickAddOverride;
  /** Skip the post-create router.refresh() — used when handing off to the edit
   *  modal, which refreshes the route on its own close. */
  skipRefresh?: boolean;
  /** When the input is empty, create with this title instead of bailing — lets
   *  "expand to editor" open on a fresh draft without the user typing first. */
  defaultTitle?: string;
}

export interface UseQuickAdd {
  input: string;
  setInput: (value: string) => void;
  /** Live parse of the current input, for the chip preview (null when empty). */
  parsed: ParsedTask | null;
  submitting: boolean;
  error: string | null;
  /** Create the task from the current input + seed (+ any override). Returns the
   *  created Task, or null if the input was empty / a create was already in
   *  flight / it failed. */
  submit: (opts?: QuickAddSubmitOptions) => Promise<Task | null>;
  reset: () => void;
}

/**
 * Shared quick-add state machine: holds the natural-language input, exposes a
 * live parse for previewing, and creates the task (merging the section `seed`)
 * via the client TasksApi, refreshing the route on success. Used by the inline
 * composer and the universal quick-add modal.
 */
export function useQuickAdd(
  seed: QuickAddSeed = {},
  opts: UseQuickAddOptions = {}
): UseQuickAdd {
  const router = useRouter();
  const { projects } = useQuickAddContext();
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // The parse needs the project list to read `#groceries` as the project rather
  // than a tag; without a provider (Storybook, tests) the list is empty and it
  // stays a tag.
  const parsed = useMemo(
    () => (input.trim() ? parseTaskInput(input, undefined, { projects }) : null),
    [input, projects]
  );

  const reset = useCallback(() => {
    setInput("");
    setError(null);
  }, []);

  const submit = useCallback(
    async (submitOpts: QuickAddSubmitOptions = {}): Promise<Task | null> => {
      const raw = input.trim() || submitOpts.defaultTitle?.trim() || "";
      if (!raw || submitting) return null;
      setSubmitting(true);
      setError(null);

      let finalInput = buildCreateInput(raw, seed, undefined, projects);
      if (submitOpts.override)
        finalInput = applyOverride(finalInput, submitOpts.override);

      const tasks = await getClientTasksApi();
      const { data, error: createError } = await tasks.create(finalInput);
      setSubmitting(false);

      if (createError) {
        setError(createError.message);
        return null;
      }
      if (opts.keepOpen) setInput("");
      // The draggable views hold prop-synced local copies and reconcile on
      // refresh; let the server re-render place the new task in its section.
      if (!submitOpts.skipRefresh) startTransition(() => router.refresh());
      return data;
    },
    [input, submitting, seed, projects, opts.keepOpen, router]
  );

  return { input, setInput, parsed, submitting, error, submit, reset };
}
