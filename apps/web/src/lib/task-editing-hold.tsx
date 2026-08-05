"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Task } from "@do-done/shared";

/**
 * Keeps the row of a task whose editor is open exactly where it is, however
 * the edit re-qualifies the task for the view it was opened from.
 *
 * The editor auto-saves, and every save refreshes the server components — so
 * setting Status to "next" from the Inbox, or pushing a Today task out to next
 * week, drops the task from the view's query mid-edit, and the list unmounts
 * the row. That used to take the editor with it, the modal being rendered *by*
 * the row: one field change and it shut, with no way back to it and nothing to
 * undo the change with. The editor is now mounted app-wide (`OpenTaskProvider`)
 * and survives regardless — but the row still shouldn't vanish or hop groups
 * behind an open modal, which is what this holds still.
 *
 * So a list holds on to the row until the editor closes. The held copy is the
 * task as it looked when the editor opened, which is also what keeps the row
 * still: filters, groups and sorts all read the pre-edit values, so the row
 * neither disappears nor hops to another group behind the modal. On close the
 * hold is released and the (already refreshed) server data decides — the task
 * settles into its new home, or leaves the view, in one move.
 *
 * The registry is global (one provider at the app layout) because the holder is
 * a row deep inside whichever list is on screen. A list only ever re-inserts a
 * task it was already showing, so a hold taken in one view can't leak a row
 * into another view that never had it.
 */
interface TaskEditingHold {
  /** Tasks currently held open for editing, keyed by id. */
  held: ReadonlyMap<string, Task>;
  /** Hold `task`'s row, in the state it's in now, until released. */
  hold: (task: Task) => void;
  release: (taskId: string) => void;
}

const NO_HOLDS: ReadonlyMap<string, Task> = new Map();

const TaskEditingHoldContext = createContext<TaskEditingHold>({
  held: NO_HOLDS,
  hold: () => {},
  release: () => {},
});

export function TaskEditingHoldProvider({ children }: { children: ReactNode }) {
  const [held, setHeld] = useState<ReadonlyMap<string, Task>>(NO_HOLDS);

  const hold = useCallback((task: Task) => {
    setHeld((prev) => {
      if (prev.get(task.id) === task) return prev;
      const next = new Map(prev);
      next.set(task.id, task);
      return next;
    });
  }, []);

  const release = useCallback((taskId: string) => {
    setHeld((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Map(prev);
      next.delete(taskId);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ held, hold, release }), [held, hold, release]);

  return (
    <TaskEditingHoldContext.Provider value={value}>
      {children}
    </TaskEditingHoldContext.Provider>
  );
}

/**
 * Row side: hold this row for as long as its editor is open.
 *
 * The snapshot is taken on the open, not on every render — the row goes on
 * showing the task the user opened, rather than tracking the saves landing
 * underneath it.
 */
export function useHoldWhileEditing(task: Task, editing: boolean) {
  const { hold, release } = useContext(TaskEditingHoldContext);
  const taskId = task.id;
  // Kept aside rather than closed over, so a save landing under an open editor
  // doesn't re-run the hold effect and re-take the snapshot. Declared first:
  // effects run in order, so it's already current when the hold below reads it.
  const latest = useRef(task);
  useEffect(() => {
    latest.current = task;
  }, [task]);

  useEffect(() => {
    if (!editing) return;
    hold(latest.current);
    return () => release(taskId);
  }, [editing, taskId, hold, release]);
}

/**
 * List side: the tasks to render, with any held row put back.
 *
 * Returns `tasks` itself when nothing is held, so a view that never opens an
 * editor keeps its existing referential stability (the lists memoise on it, and
 * several mirror it into drag state).
 */
export function useTasksHeldForEditing(tasks: Task[]): Task[] {
  const { held } = useContext(TaskEditingHoldContext);
  // What this list rendered last, so a row that has just dropped out of the
  // server data goes back at the index it occupied — and so we can tell a row
  // this list was showing from one held by some other view.
  const lastRendered = useRef<Task[]>(tasks);

  const merged = useMemo(() => {
    if (held.size === 0) return tasks;
    const out: Task[] = tasks.map((t) => held.get(t.id) ?? t);
    for (const [id, task] of held) {
      if (tasks.some((t) => t.id === id)) continue;
      // Reading the ref here is the point of it: the answer is "where was this
      // row the last time we committed", which is by definition not derivable
      // from this render's inputs. It only ever changes in response to one of
      // the dependencies below, so the memo stays consistent with it.
      // eslint-disable-next-line react-hooks/refs
      const at = lastRendered.current.findIndex((t) => t.id === id);
      if (at < 0) continue; // not this list's row to hold
      out.splice(Math.min(at, out.length), 0, task);
    }
    return out;
  }, [tasks, held]);

  useEffect(() => {
    lastRendered.current = merged;
  }, [merged]);

  return merged;
}
