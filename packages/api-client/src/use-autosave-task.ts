"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import type { Task, UpdateTaskInput } from "@do-done/shared";
import type { TasksApi } from "./tasks.js";

/**
 * Hook for the task edit modal autosave pattern.
 *
 * Lifecycle:
 *   1. Modal opens → `useAutoSaveTask(initial, api)` snapshots `initial`.
 *   2. User edits a field → `setField` updates local state, queues a
 *      250ms debounced save to Supabase.
 *   3. Multiple rapid edits to different fields coalesce into one PATCH.
 *   4. `undoAll` cancels any pending save, then writes the snapshot back
 *      to the DB and resets local state.
 *   5. `lastSavedAt` ticks after each successful save → drives the UI
 *      pulse indicator.
 *
 * The hook is React-only (no DOM/RN-specific code) so it works in both
 * apps/web and apps/mobile.
 *
 * Reconciling the list views (`onSaved`):
 *   The save writes straight to Supabase via `api.update`. That PATCH is
 *   invisible to whatever holds the list views' data (Next's server-component
 *   cache on web, TanStack Query on mobile), so without a nudge they keep
 *   rendering the pre-edit row until a hard refresh. `onSaved` fires *after
 *   each successful commit* — wire it to `router.refresh()` (web) or
 *   `invalidateTasks()` (mobile). Firing it post-commit (not on modal close)
 *   is deliberate: a close-time refresh races the in-flight/debounced PATCH and
 *   re-reads the stale row.
 *
 * Race-condition guards:
 *   - `taskRef` always reads the latest task at debounce-fire time
 *     (avoids closing over a stale value).
 *   - `flushOnExit` flushes a still-pending save when the modal unmounts.
 *     Without it, closing within the debounce window drops the edit entirely
 *     (use-debounce no-ops a queued timer once the hook is unmounted), so the
 *     "Saved" the user saw would be a lie.
 *   - `undoAll` cancels the pending debounce before writing the snapshot
 *     (otherwise a flushed save could land after the revert).
 *   - Errors from individual saves don't roll back local state — surface
 *     them via `lastError` so the UI can show a "save failed" hint.
 */
export interface UseAutoSaveTaskResult {
  /** Current task state with local edits applied. */
  task: Task;
  /** Update one field; queues a debounced save. */
  setField: <K extends keyof Task>(key: K, value: Task[K]) => void;
  /** Cancel pending save, write snapshot back to DB, reset local state. */
  undoAll: () => Promise<void>;
  /** True iff `task` differs from the initial snapshot. */
  hasChanges: boolean;
  /** Timestamp of the last successful save, or null if none yet. */
  lastSavedAt: Date | null;
  /** True while a save is in flight. */
  isSaving: boolean;
  /** The most recent save error, or null if the last save succeeded. */
  lastError: Error | null;
}

export interface UseAutoSaveTaskOptions {
  /** Debounce in ms before each save fires. Defaults to 250. */
  debounceMs?: number;
  /**
   * Called after each successful save (debounced, flushed-on-unmount, or the
   * `undoAll` write-back). Use it to reconcile the list views with the row that
   * just changed — `router.refresh()` on web, `invalidateTasks()` on mobile.
   * Not called when a save fails (watch `lastError` for that).
   */
  onSaved?: () => void;
}

/**
 * Compute a shallow patch (only changed fields) from a → b.
 * Keeps the network PATCH minimal and obvious in DB logs.
 *
 * Exported for testing. Not part of the stable public API.
 */
export function shallowDiff(a: Task, b: Task): Partial<Task> {
  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Task>;
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    // Array equality: shallow compare.
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (
        av.length !== bv.length ||
        av.some((v, i) => v !== bv[i])
      ) {
        patch[k as string] = bv;
      }
      continue;
    }
    if (av !== bv) patch[k as string] = bv;
  }
  return patch as Partial<Task>;
}

/**
 * Convert a Partial<Task> patch into the UpdateTaskInput shape the
 * TasksApi.update method expects. Strips fields that aren't writable
 * (id, user_id, depth, timestamps).
 *
 * Exported for testing. Not part of the stable public API.
 */
export function toUpdateInput(patch: Partial<Task>): UpdateTaskInput {
  const readonly = new Set<keyof Task>([
    "id",
    "user_id",
    "depth",
    "created_at",
    "updated_at",
    "completed_at",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (readonly.has(k as keyof Task)) continue;
    out[k] = v;
  }
  return out as UpdateTaskInput;
}

export function useAutoSaveTask(
  initial: Task,
  api: TasksApi,
  options: UseAutoSaveTaskOptions = {}
): UseAutoSaveTaskResult {
  const debounceMs = options.debounceMs ?? 250;

  // Snapshot is captured once on mount. We pin it via useRef so changes
  // to `initial` after the first render are ignored (the contract is
  // "the modal locks in the state it opened with").
  const snapshotRef = useRef<Task>(initial);

  const [task, setTask] = useState<Task>(initial);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);

  // Always read the latest task from the ref inside the debounced
  // callback — closing over `task` directly captures a stale value.
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  // Same trick for `onSaved`: read the latest via a ref so a changing callback
  // identity never recreates the debounce (which would drop a queued save).
  const onSavedRef = useRef(options.onSaved);
  useEffect(() => {
    onSavedRef.current = options.onSaved;
  }, [options.onSaved]);

  const debouncedSave = useDebouncedCallback(
    async () => {
      const current = taskRef.current;
      const patch = shallowDiff(snapshotRef.current, current);
      if (Object.keys(patch).length === 0) return;

      setIsSaving(true);
      try {
        const { error } = await api.update(current.id, toUpdateInput(patch));
        if (error) {
          setLastError(error as Error);
        } else {
          setLastError(null);
          setLastSavedAt(new Date());
          onSavedRef.current?.();
        }
      } catch (err) {
        setLastError(err as Error);
      } finally {
        setIsSaving(false);
      }
    },
    debounceMs,
    // Flush a still-pending save when the modal unmounts, so closing within the
    // debounce window persists the edit (and fires `onSaved`) instead of losing it.
    { flushOnExit: true }
  );

  const setField = useCallback(
    <K extends keyof Task>(key: K, value: Task[K]) => {
      setTask((prev) => ({ ...prev, [key]: value }));
      debouncedSave();
    },
    [debouncedSave]
  );

  const undoAll = useCallback(async () => {
    // Cancel any pending save so a flushed PATCH can't clobber the revert.
    debouncedSave.cancel();
    const snapshot = snapshotRef.current;
    // Optimistic: revert local state immediately so the UI snaps back. The
    // user wanted to undo, so the visible state should reflect that on the
    // next paint — not after the round-trip. A subsequent network failure
    // surfaces via `lastError` but the local revert stands.
    setTask(snapshot);
    setLastError(null);
    setIsSaving(true);
    try {
      const { error } = await api.update(snapshot.id, toUpdateInput(snapshot));
      if (error) {
        setLastError(error as Error);
      } else {
        setLastSavedAt(new Date());
        onSavedRef.current?.();
      }
    } catch (err) {
      setLastError(err as Error);
    } finally {
      setIsSaving(false);
    }
  }, [api, debouncedSave]);

  const hasChanges = useMemo(() => {
    return Object.keys(shallowDiff(snapshotRef.current, task)).length > 0;
  }, [task]);

  return {
    task,
    setField,
    undoAll,
    hasChanges,
    lastSavedAt,
    isSaving,
    lastError,
  };
}
