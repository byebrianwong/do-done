"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseTaskInput } from "@do-done/task-engine";
import type { ParsedTask, Task } from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { buildCreateInput, type QuickAddSeed } from "./quick-add";

export interface UseQuickAddOptions {
  /** After a successful create, clear the input for rapid multi-add instead of
   *  expecting the caller to unmount. */
  keepOpen?: boolean;
}

export interface UseQuickAdd {
  input: string;
  setInput: (value: string) => void;
  /** Live parse of the current input, for the chip preview (null when empty). */
  parsed: ParsedTask | null;
  submitting: boolean;
  error: string | null;
  /** Create the task from the current input + seed. Returns the created Task,
   *  or null if the input was empty / a create already in flight / it failed. */
  submit: () => Promise<Task | null>;
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
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const parsed = useMemo(
    () => (input.trim() ? parseTaskInput(input) : null),
    [input]
  );

  const reset = useCallback(() => {
    setInput("");
    setError(null);
  }, []);

  const submit = useCallback(async (): Promise<Task | null> => {
    if (!input.trim() || submitting) return null;
    setSubmitting(true);
    setError(null);

    const tasks = await getClientTasksApi();
    const { data, error: createError } = await tasks.create(
      buildCreateInput(input, seed)
    );
    setSubmitting(false);

    if (createError) {
      setError(createError.message);
      return null;
    }
    if (opts.keepOpen) setInput("");
    // The draggable views hold prop-synced local copies and reconcile on
    // refresh; let the server re-render place the new task in its section.
    startTransition(() => router.refresh());
    return data;
  }, [input, submitting, seed, opts.keepOpen, router]);

  return { input, setInput, parsed, submitting, error, submit, reset };
}
