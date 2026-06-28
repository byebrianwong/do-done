"use client";

import { useCallback, useState } from "react";
import type { CreateTaskInput, Task, TaskPriority } from "@do-done/shared";
import { useQuickAdd, type UseQuickAddOptions } from "./use-quick-add";
import type { QuickAddSeed } from "./quick-add";

/**
 * The quick-add state machine shared by every inline surface (the top-of-page
 * bar, the per-section composer) and the modal. Wraps {@link useQuickAdd} with:
 *  - explicit chip overrides (When / Priority / Project / Estimate) that win
 *    over the parsed text + section seed, and
 *  - the "expand to the full editor" handoff: create the task now, then open
 *    `TaskEditModalV2` on the persisted task for complete control.
 */
export function useQuickAddComposer(
  seed: QuickAddSeed,
  opts: UseQuickAddOptions = {}
) {
  const base = useQuickAdd(seed, opts);
  const { submit, reset } = base;

  // Chip overrides — explicit selections that win over parsed text + seed.
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [whenDate, setWhenDate] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  // The task created by "expand", handed off to the full editor.
  const [handoffTask, setHandoffTask] = useState<Task | null>(null);

  const anyChipSet =
    priority != null ||
    duration != null ||
    whenDate != null ||
    projectId != null;

  const buildOverride = useCallback(
    (): Partial<CreateTaskInput> => ({
      ...(priority && { priority }),
      ...(duration && { duration_minutes: duration }),
      ...(projectId && { project_id: projectId }),
      ...(whenDate && { when_date: whenDate }),
    }),
    [priority, duration, projectId, whenDate]
  );

  const resetChips = useCallback(() => {
    setPriority(null);
    setDuration(null);
    setWhenDate(null);
    setProjectId(null);
  }, []);

  const resetAll = useCallback(() => {
    reset();
    resetChips();
  }, [reset, resetChips]);

  /** Create from the current input + chips. Returns the created task or null. */
  const add = useCallback(
    () => submit({ override: buildOverride() }),
    [submit, buildOverride]
  );

  /** Create now (no route refresh) and stage the task for the full editor. */
  const openEditor = useCallback(async (): Promise<Task | null> => {
    const created = await submit({
      override: buildOverride(),
      skipRefresh: true,
    });
    if (created) setHandoffTask(created);
    return created;
  }, [submit, buildOverride]);

  const clearHandoff = useCallback(() => setHandoffTask(null), []);

  return {
    ...base,
    priority,
    setPriority,
    duration,
    setDuration,
    whenDate,
    setWhenDate,
    projectId,
    setProjectId,
    anyChipSet,
    buildOverride,
    add,
    resetChips,
    resetAll,
    handoffTask,
    openEditor,
    clearHandoff,
  };
}
