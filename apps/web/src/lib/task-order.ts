import type { TasksApi } from "@do-done/api-client";
import {
  adoptedRanks,
  planPlacement,
  type Placement,
  type Task,
  type UpdateTaskInput,
} from "@do-done/shared";

/**
 * Show a drop in a local copy of the rows, before anything is written.
 *
 * `orderedIds` is the list the task was dropped into, after the drop. The
 * moved task takes `patch` (the field a cross-group drop changes) and a key
 * between its new neighbours. No other row changes, which is the point: the
 * server will move this one task and nothing else (see `TasksApi.place`).
 */
export function placeLocally(
  tasks: Task[],
  orderedIds: string[],
  movedId: string,
  patch: Partial<Task> = {}
): { tasks: Task[]; placement: Placement | null } {
  const keys = new Map(tasks.map((t) => [t.id, t.sort_order]));
  const placement = planPlacement(orderedIds, movedId, (id) => keys.get(id));
  return {
    placement,
    tasks: tasks.map((t) =>
      t.id === movedId
        ? ({
            ...t,
            ...patch,
            sort_order: placement?.rank ?? t.sort_order,
          } as Task)
        : t
    ),
  };
}

/**
 * Show an adopted order in a local copy: the listed tasks swap keys among
 * themselves so they sort in the listed order. What dragging a sorted view
 * into manual order looks like until `TasksApi.adoptOrder` answers.
 */
export function adoptLocally(tasks: Task[], orderedIds: string[]): Task[] {
  const keys = new Map(tasks.map((t) => [t.id, t.sort_order]));
  const dealt = adoptedRanks(orderedIds, (id) => keys.get(id));
  return tasks.map((t) =>
    dealt.has(t.id) ? { ...t, sort_order: dealt.get(t.id)! } : t
  );
}

type OrderApi = Pick<TasksApi, "update" | "place" | "adoptOrder">;

/**
 * Write a field change through `update`, so status sync, the subtree cascade
 * and the auto-sync notice run as they do for any other edit. Skipped when
 * there is nothing to change.
 */
async function writePatch(
  api: OrderApi,
  id: string,
  patch: UpdateTaskInput | undefined
): Promise<Error | null> {
  if (!patch || Object.keys(patch).length === 0) return null;
  const { error } = await api.update(id, patch);
  return error;
}

/**
 * Write a drop: the field change first, then the position.
 *
 * Two calls rather than one, because the position goes through `place_task`,
 * which reads the neighbours' current keys on the server. A failed field
 * change stops before the position is written.
 */
export async function commitPlacement(
  api: OrderApi,
  movedId: string,
  placement: Placement,
  patch?: UpdateTaskInput
): Promise<{ error: Error | null }> {
  const patchError = await writePatch(api, movedId, patch);
  if (patchError) return { error: patchError };
  // Alone in its list: there is nothing to sit next to, and the server would
  // leave the key as it is.
  if (placement.after === null && placement.before === null) return { error: null };
  const { error } = await api.place(movedId, {
    after: placement.after,
    before: placement.before,
  });
  return { error };
}

/**
 * Write a sorted view's order as the manual order: the dragged task's field
 * change, if the drop crossed groups, then the adopted order.
 */
export async function commitAdoptedOrder(
  api: OrderApi,
  orderedIds: string[],
  moved?: { id: string; patch: UpdateTaskInput }
): Promise<{ error: Error | null }> {
  const patchError = moved ? await writePatch(api, moved.id, moved.patch) : null;
  if (patchError) return { error: patchError };
  return api.adoptOrder(orderedIds);
}
