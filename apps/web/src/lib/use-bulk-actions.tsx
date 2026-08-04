"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskPriority, UpdateTaskInput } from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { toCreateInput } from "@/lib/task-create-input";
import { useTaskSelection } from "@/lib/task-selection";
import { useUndoToast } from "@/components/undo-toast";

export interface BulkActions {
  count: number;
  /** True while a bulk write is in flight / the refresh transition is pending. */
  pending: boolean;
  setProject: (projectId: string | null) => Promise<void>;
  setPriority: (priority: TaskPriority) => Promise<void>;
  /** Set (or, with null, clear) the do-date on every selected task. */
  schedule: (date: string | null) => Promise<void>;
  complete: () => Promise<void>;
  /** Delete every selected task, with a single undo that recreates them all. */
  remove: () => Promise<void>;
  clear: () => void;
}

/**
 * Bulk mutations bound to the current task selection. Writes go through
 * `TasksApi.bulkUpdate` (which fans out to `update`, so completion stamps
 * `completed_at` and pet feeding still fires per task), then clear the
 * selection and refresh the route. Shared by the floating bar and the
 * right-click bulk menu so both stay behaviourally identical.
 */
export function useBulkActions(): BulkActions {
  const selection = useTaskSelection();
  const router = useRouter();
  const toast = useUndoToast();
  const [pending, startTransition] = useTransition();

  const applyPatch = useCallback(
    async (patch: UpdateTaskInput) => {
      const ids = [...selection.selectedIds];
      if (ids.length === 0) return;
      const api = await getClientTasksApi();
      const { error, failedIds } = await api.bulkUpdate(
        ids.map((id) => ({ id, input: patch }))
      );
      if (error) {
        console.error(
          `Bulk update failed for ${failedIds.length}/${ids.length} tasks:`,
          error
        );
      }
      // A partial failure still wrote most of the batch, so clear and refresh
      // either way — bailing early left those writes invisible until a reload.
      selection.clear();
      startTransition(() => router.refresh());
    },
    [selection, router]
  );

  const remove = useCallback(async () => {
    // Snapshot the full task objects *before* clearing so undo can recreate
    // them (delete is a hard delete; there's no server-side trash).
    const tasks = selection.getSelectedTasks();
    const ids = [...selection.selectedIds];
    if (ids.length === 0) return;

    const api = await getClientTasksApi();
    const results = await Promise.all(ids.map((id) => api.delete(id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) console.error("Bulk delete failed:", failed.error);

    selection.clear();
    startTransition(() => router.refresh());

    if (tasks.length > 0) {
      toast.show({
        message: `Deleted ${tasks.length} task${tasks.length > 1 ? "s" : ""}`,
        undo: async () => {
          const recreate = await getClientTasksApi();
          await Promise.all(
            tasks.map((t) => recreate.create(toCreateInput(t, t.title)))
          );
          startTransition(() => router.refresh());
        },
      });
    }
  }, [selection, router, toast]);

  return {
    count: selection.count,
    pending,
    setProject: (projectId) => applyPatch({ project_id: projectId }),
    setPriority: (priority) => applyPatch({ priority }),
    schedule: (date) =>
      applyPatch(date ? { scheduled_date: date } : { scheduled_date: null, scheduled_time: null }),
    complete: () => applyPatch({ status: "done" }),
    remove,
    clear: selection.clear,
  };
}
