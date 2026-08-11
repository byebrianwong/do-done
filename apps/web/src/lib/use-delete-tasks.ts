"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TASK_DELETE_EXIT_MS, type Task } from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import {
  announceDeleteCancelled,
  announceDeleting,
} from "@/lib/task-delete-events";
import { prefersReducedMotion } from "@/lib/use-row-exit";
import { useUndoToast } from "@/components/undo-toast";

/** Delete one or more tasks, animating every row that is on screen for them. */
export type DeleteTasks = (tasks: Task[]) => Promise<void>;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The one door every delete on the web app goes through.
 *
 * There are four of them — the row's right-click menu, the editor modal's
 * Delete, the bulk bar, and the bulk right-click menu — and before this each
 * did its own thing: two showed an undo toast, one showed nothing at all, and
 * none of them gave the row a way to leave. A delete would land, the route
 * would refresh, and the list was simply one row shorter than it had been,
 * with nothing on screen saying which one had gone.
 *
 * So the sequence is fixed here rather than at the call sites:
 *
 *   1. tell the rows they are going — they start dimming immediately, before
 *      anything touches the network, because that is the acknowledgement;
 *   2. write;
 *   3. put the toast up, which is the row's receipt and the only way back;
 *   4. hold the refresh until the animation's envelope is spent, so the removal
 *      lands on a row that is already invisible instead of cutting it short.
 *
 * A failed write takes step 1 back and says so. This mirrors the completion
 * path in `task-item.tsx`, deliberately — the two exits are the same shape.
 */
export function useDeleteTasks(): { deleteTasks: DeleteTasks; pending: boolean } {
  const router = useRouter();
  const toast = useUndoToast();
  const [pending, startTransition] = useTransition();

  const deleteTasks = useCallback<DeleteTasks>(
    async (tasks) => {
      const ids = tasks.map((t) => t.id);
      if (ids.length === 0) return;

      // Paint first. The row starts leaving on this frame; the write follows.
      announceDeleting(ids);
      const startedAt = Date.now();

      const api = await getClientTasksApi();
      const results = await Promise.all(ids.map((id) => api.delete(id)));
      const failed = results.filter((r) => r.error);
      if (failed[0]?.error) console.error("Delete failed:", failed[0].error);

      // Every row the delete actually touched — the tasks *and* their subtrees,
      // which is what undo has to put back. Collected from the writes rather
      // than from what the caller handed us: a task's subtasks are rows the
      // list never showed and the caller has no idea exist.
      const deletedRowIds = results
        .filter((r) => !r.error)
        .flatMap((r) => r.ids);

      if (failed.length === ids.length) {
        // Nothing landed, so nothing is leaving. Say so rather than letting the
        // rows spring back with no explanation.
        announceDeleteCancelled(ids);
        toast.show({
          message:
            ids.length === 1
              ? `Couldn't delete “${tasks[0].title}”`
              : `Couldn't delete ${ids.length} tasks`,
        });
        return;
      }

      // The rows that failed are still on the server and come back with the
      // refresh below — a partial failure is reported by the list, not by
      // stranding the whole batch mid-animation.
      const deleted = tasks.filter((_, i) => !results[i].error);

      toast.show({
        message:
          deleted.length === 1
            ? `Deleted “${deleted[0].title}”`
            : `Deleted ${deleted.length} tasks`,
        // Undo *restores*. The rows were never destroyed — deleting stamps
        // `deleted_at` and hides them — so this clears one column and the task
        // is back: same id, same subtasks, same files, same links. It used to
        // recreate from a snapshot, which gave back a new row wearing the old
        // title and quietly dropped everything hanging off it.
        undo: async () => {
          const restore = await getClientTasksApi();
          const { error } = await restore.restore(deletedRowIds);
          if (error) {
            console.error("Undo delete failed:", error);
            // A silent failure here reads as a dead button — the user taps
            // Undo, the task stays gone, and nothing tells them why.
            toast.show({
              message:
                deleted.length === 1
                  ? `Couldn't bring “${deleted[0].title}” back`
                  : `Couldn't bring those ${deleted.length} tasks back`,
            });
            return;
          }
          // Any row still collapsing gets to stand back up; one already
          // unmounted by the refresh simply never hears this.
          announceDeleteCancelled(deletedRowIds);
          startTransition(() => router.refresh());
        },
      });

      // Measured from the announcement, not from here: a slow write has already
      // spent part of the animation's runtime, and waiting the full envelope on
      // top of it would leave a finished row sitting there at zero height.
      if (!prefersReducedMotion()) {
        const remaining = TASK_DELETE_EXIT_MS - (Date.now() - startedAt);
        if (remaining > 0) await sleep(remaining);
      }
      startTransition(() => router.refresh());
    },
    [router, toast]
  );

  return { deleteTasks, pending };
}
