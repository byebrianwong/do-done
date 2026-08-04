"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
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
 *   5. `status` walks idle → pending → saving → saved → idle, driving the UI
 *      indicator; `lastSavedAt` ticks alongside it for callers that want the
 *      wall-clock time of the last commit.
 *
 * Feedback timing (`status`):
 *   `isSaving` alone can't drive an honest indicator: it only goes true once
 *   the debounce elapses AND the request is in flight, so for the first 250ms
 *   after a keystroke — and for the whole time the user keeps typing, since
 *   each keystroke restarts the debounce — the UI still reads "Saved" for text
 *   that is nowhere but local state. On a fast connection the in-flight window
 *   is then too short to see, so the indicator never visibly moves at all.
 *   `status` adds the missing `pending` phase, entered synchronously in
 *   `setField`, so typing acknowledges itself on the same tick as the
 *   keystroke. See `nextSaveStatus` for the full machine.
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
/**
 * Where the editor's edits are, as far as the user needs to care.
 *
 * - `idle`    — local state matches the server; nothing outstanding.
 * - `pending` — an edit has landed locally and a save is queued but not yet
 *               sent. Set synchronously from `setField`, which is what makes
 *               the indicator move on the keystroke rather than 250ms later.
 * - `saving`  — the PATCH is in flight.
 * - `saved`   — the last save committed. Transient: the hook schedules a
 *               `settle` back to `idle` so "Saved" reads as an event that just
 *               happened, not as a permanent claim about the sheet.
 * - `error`   — the last save failed. `lastError` carries the detail.
 */
export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/** Transitions fed to {@link nextSaveStatus}. */
export type SaveEvent =
  /** A field changed; a save is queued. */
  | { type: "edit" }
  /** The queued save found a non-empty patch and is now in flight. */
  | { type: "commit" }
  /** The queued save fired but the row already matches — nothing to write. */
  | { type: "noop" }
  | { type: "success" }
  | { type: "failure" }
  /** The "Saved" flash has run its course. */
  | { type: "settle" };

/**
 * How long "Saved" stays up before settling back to `idle`.
 *
 * Long enough to register as a confirmation, short enough that it's gone
 * before the next edit — an indicator stuck on "Saved" is the thing this
 * whole state machine exists to stop.
 */
export const SAVED_FLASH_MS = 1600;

/**
 * The save-indicator state machine, as a pure function so it can be tested
 * without a renderer.
 *
 * The two rules worth stating outright, because both are about not lying to
 * the user:
 *
 * - `success` while `pending` stays `pending`. The user typed again while the
 *   PATCH was in flight, so the commit that just landed is already stale;
 *   flashing "Saved" over unsent keystrokes is exactly the bug being fixed.
 * - `settle` only applies to `saved`. The flash timer is fire-and-forget, so a
 *   late one must not wipe a `pending`/`error` the user has since moved into.
 */
export function nextSaveStatus(current: SaveStatus, event: SaveEvent): SaveStatus {
  switch (event.type) {
    case "edit":
      return "pending";
    case "commit":
      return "saving";
    case "noop":
      // The debounce fired on a patch that turned out empty (typed and then
      // undone by hand, say). Nothing is outstanding, so drop the pending hint
      // rather than leaving it up with no save coming to clear it.
      return current === "pending" || current === "saving" ? "idle" : current;
    case "success":
      return current === "pending" ? "pending" : "saved";
    case "failure":
      return "error";
    case "settle":
      return current === "saved" ? "idle" : current;
  }
}

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
  /**
   * Full save phase, including the queued-but-not-yet-sent window `isSaving`
   * can't express. Drive user-facing indicators off this.
   */
  status: SaveStatus;
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
  const [status, dispatch] = useReducer(nextSaveStatus, "idle" as SaveStatus);

  // Drop "Saved" back to "idle" after the flash. Keyed on `status` so a new
  // save restarts the timer, and cleaned up on unmount so a closing sheet
  // doesn't set state from a dead timer.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => dispatch({ type: "settle" }), SAVED_FLASH_MS);
    return () => clearTimeout(t);
  }, [status]);

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
      if (Object.keys(patch).length === 0) {
        dispatch({ type: "noop" });
        return;
      }

      setIsSaving(true);
      dispatch({ type: "commit" });
      try {
        const { error } = await api.update(current.id, toUpdateInput(patch));
        if (error) {
          setLastError(error as Error);
          dispatch({ type: "failure" });
        } else {
          setLastError(null);
          setLastSavedAt(new Date());
          dispatch({ type: "success" });
          onSavedRef.current?.();
        }
      } catch (err) {
        setLastError(err as Error);
        dispatch({ type: "failure" });
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
      // Same tick as the keystroke, before the debounce has even been armed —
      // this is the feedback the indicator shows while the save is queued.
      dispatch({ type: "edit" });
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
    dispatch({ type: "commit" });
    try {
      const { error } = await api.update(snapshot.id, toUpdateInput(snapshot));
      if (error) {
        setLastError(error as Error);
        dispatch({ type: "failure" });
      } else {
        setLastSavedAt(new Date());
        dispatch({ type: "success" });
        onSavedRef.current?.();
      }
    } catch (err) {
      setLastError(err as Error);
      dispatch({ type: "failure" });
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
    status,
    lastError,
  };
}
