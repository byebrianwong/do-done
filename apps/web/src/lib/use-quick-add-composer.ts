"use client";

import { useCallback, useMemo, useState } from "react";
import type { Task, TaskPriority } from "@do-done/shared";
import { useQuickAdd, type UseQuickAddOptions } from "./use-quick-add";
import {
  contextFacets,
  type QuickAddOverride,
  type QuickAddSeed,
} from "./quick-add";

/**
 * What the user has explicitly picked from the chips. A key is *absent* until
 * they touch that chip; present-and-null means they cleared it. Absent is what
 * lets the seed and the typed text keep speaking for a facet — the distinction
 * this whole hook turns on.
 */
type PickedFacets = Pick<
  QuickAddOverride,
  "priority" | "duration_minutes" | "scheduled_date" | "project_id"
>;

/**
 * The quick-add state machine shared by every inline surface (the top-of-page
 * bar, the per-section composer) and the modal. Wraps {@link useQuickAdd} with:
 *  - the When / Priority / Project / Estimate chips, and
 *  - the "expand to the full editor" handoff: create the task now, then open
 *    `TaskEditModalV2` on the persisted task for complete control.
 *
 * **A chip shows what the task would be created with, not what the user has
 * typed into it.** Untouched, it reflects the surface's own context — the
 * project page's project, Today's date — and then whatever the text says once
 * it says something, which is exactly `buildCreateInput`'s precedence
 * ({@link contextFacets}). Touching one pins it: the pick wins over both, and
 * clearing it wins too, so a seeded project can be dropped without leaving the
 * page. A successful create returns every chip to the surface's context, ready
 * for the next task in the same place.
 */
export function useQuickAddComposer(
  seed: QuickAddSeed,
  opts: UseQuickAddOptions = {}
) {
  const base = useQuickAdd(seed, opts);
  const { submit, reset, input, parsed } = base;

  const [picked, setPicked] = useState<PickedFacets>({});

  // Recomputed per render rather than memoised on `seed`: every call site
  // passes an object literal, so its identity changes anyway.
  const facets = contextFacets(seed, parsed);

  const priority = picked.priority !== undefined ? picked.priority : facets.priority;
  const duration =
    picked.duration_minutes !== undefined
      ? picked.duration_minutes
      : facets.duration_minutes;
  const scheduledDate =
    picked.scheduled_date !== undefined
      ? picked.scheduled_date
      : facets.scheduled_date;
  const projectId =
    picked.project_id !== undefined ? picked.project_id : facets.project_id;

  const setPriority = useCallback(
    (p: TaskPriority | null) => setPicked((prev) => ({ ...prev, priority: p })),
    []
  );
  const setDuration = useCallback(
    (m: number | null) => setPicked((prev) => ({ ...prev, duration_minutes: m })),
    []
  );
  const setScheduledDate = useCallback(
    (d: string | null) => setPicked((prev) => ({ ...prev, scheduled_date: d })),
    []
  );
  const setProjectId = useCallback(
    (id: string | null) => setPicked((prev) => ({ ...prev, project_id: id })),
    []
  );

  // The task created by "expand", handed off to the full editor. `isDraft` marks
  // a task created from an *empty* composer (a throwaway titled "New task") so
  // the editor can drop it again if the user closes without editing.
  const [handoffTask, setHandoffTask] = useState<Task | null>(null);
  const [handoffIsDraft, setHandoffIsDraft] = useState(false);

  // Whether the *user* has set anything, which is what keeps a surface open —
  // not whether a chip shows a value. A project page's bar would never collapse
  // again if its own seed counted as a selection.
  const anyChipSet = useMemo(() => Object.keys(picked).length > 0, [picked]);

  const buildOverride = useCallback((): QuickAddOverride => ({ ...picked }), [
    picked,
  ]);

  const resetChips = useCallback(() => setPicked({}), []);

  const resetAll = useCallback(() => {
    reset();
    resetChips();
  }, [reset, resetChips]);

  /** Create from the current input + chips. Returns the created task or null. */
  const add = useCallback(
    () => submit({ override: buildOverride() }),
    [submit, buildOverride]
  );

  /**
   * Create now (no route refresh) and stage the task for the full editor. With
   * an empty composer this returns null unless `allowEmpty` is set, in which
   * case it creates a throwaway draft (title "New task") so the editor still has
   * something to open on — the inline surfaces pass `allowEmpty` so you can
   * expand straight into the full editor without typing first.
   */
  const openEditor = useCallback(
    async (opts?: { allowEmpty?: boolean }): Promise<Task | null> => {
      const isDraft = !input.trim();
      if (isDraft && !opts?.allowEmpty) return null;
      const created = await submit({
        override: buildOverride(),
        skipRefresh: true,
        ...(isDraft ? { defaultTitle: "New task" } : {}),
      });
      if (created) {
        setHandoffTask(created);
        setHandoffIsDraft(isDraft);
      }
      return created;
    },
    [input, submit, buildOverride]
  );

  const clearHandoff = useCallback(() => {
    setHandoffTask(null);
    setHandoffIsDraft(false);
  }, []);

  return {
    ...base,
    priority,
    setPriority,
    duration,
    setDuration,
    scheduledDate,
    setScheduledDate,
    projectId,
    setProjectId,
    anyChipSet,
    buildOverride,
    add,
    resetChips,
    resetAll,
    handoffTask,
    handoffIsDraft,
    openEditor,
    clearHandoff,
  };
}
