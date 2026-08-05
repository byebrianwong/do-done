"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { Task } from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { TASK_PARAM, taskPath } from "@/lib/task-link";

interface OpenTaskValue {
  /** The task whose editor is on screen, or null when nothing is open. */
  task: Task | null;
  /** Open the editor on a task the caller already holds (a list row, a hit). */
  open: (task: Task) => void;
  /** Open by id, resolving the row first — for callers holding only an id. */
  openById: (id: string) => void;
  close: () => void;
}

/**
 * Null outside the provider so surfaces that render without it (Storybook,
 * unit tests) can fall back to their own local modal state instead of
 * crashing. See `TaskItem`.
 */
const OpenTaskContext = createContext<OpenTaskValue | null>(null);

/** Read the `?task=` id out of the live address bar. */
function taskIdFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get(TASK_PARAM);
}

/**
 * The `?task=` id the current URL *should* carry for a given open task. Null on
 * the task's own page, where the path already names it — `/task/abc?task=abc`
 * is the one place the param would be pure noise, and it's exactly the page a
 * shared link lands on.
 */
function wantedParam(id: string | null): string | null {
  if (!id) return null;
  return window.location.pathname === taskPath(id) ? null : id;
}

/** The current URL with `?task=` set to `id`, or stripped when id is null. */
function urlWithTask(id: string | null): string {
  const url = new URL(window.location.href);
  const param = wantedParam(id);
  if (param) url.searchParams.set(TASK_PARAM, param);
  else url.searchParams.delete(TASK_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Owns *the* open task editor for the whole authenticated app, and keeps it in
 * step with the URL — which is what makes a task shareable: whatever is on
 * screen has an address, and any address can be pasted back.
 *
 * The URL is written with the native History API rather than `router.push`, on
 * purpose: opening a task must stay instant. A router navigation would re-run
 * the server components of the list underneath on every row click, and none of
 * that work changes — the list is already rendered, the editor is a layer above
 * it. `popstate` keeps our state honest when the user presses Back.
 *
 * Holding the editor here rather than in each row also means a task can only
 * ever be open once, however many lists happen to be showing that row.
 *
 * @see `lib/task-link.ts` for the two URL shapes and why both exist.
 */
export function OpenTaskProvider({
  children,
  onMissing,
}: {
  children: React.ReactNode;
  /** Called when a pasted `?task=` id resolves to nothing (deleted, or not ours). */
  onMissing?: () => void;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const pathname = usePathname();
  // Mirror of `task` for the callbacks below, which need the current value at
  // call time and must not do their history writes inside a state updater
  // (React may re-run those).
  const taskRef = useRef<Task | null>(null);
  const setOpenTask = useCallback((next: Task | null) => {
    taskRef.current = next;
    setTask(next);
  }, []);

  // Whether the history entry the editor rides on is one we pushed. Only then
  // may close() pop it; on a pasted link the entry is the user's own arrival,
  // and going "back" from there would leave the app entirely.
  const pushedRef = useRef(false);
  // Guards against a slow getById landing after the user closed the editor.
  const resolvingRef = useRef<string | null>(null);

  const resolve = useCallback(
    async (id: string) => {
      resolvingRef.current = id;
      const api = await getClientTasksApi();
      const { data } = await api.getById(id);
      if (resolvingRef.current !== id) return;
      resolvingRef.current = null;
      if (data) {
        setOpenTask(data);
        return;
      }
      // Nothing there — don't leave a dead id in the address bar.
      window.history.replaceState(null, "", urlWithTask(null));
      onMissing?.();
    },
    [onMissing, setOpenTask]
  );

  const open = useCallback(
    (next: Task) => {
      resolvingRef.current = null;
      if (taskIdFromLocation()) {
        // Swapping tasks while the editor is already up would otherwise stack a
        // second history entry, so Back would step sideways instead of closing.
        window.history.replaceState(null, "", urlWithTask(next.id));
      } else {
        window.history.pushState(null, "", urlWithTask(next.id));
        pushedRef.current = true;
      }
      setOpenTask(next);
    },
    [setOpenTask]
  );

  const openById = useCallback((id: string) => void resolve(id), [resolve]);

  const close = useCallback(() => {
    resolvingRef.current = null;
    setOpenTask(null);
    if (pushedRef.current) {
      pushedRef.current = false;
      // Pop our own entry so Esc and Back leave the same history behind.
      window.history.back();
    } else {
      window.history.replaceState(null, "", urlWithTask(null));
    }
  }, [setOpenTask]);

  // A pasted or bookmarked link. Read from `window.location` rather than
  // `useSearchParams()` so this provider imposes no Suspense boundary on the
  // layout it's mounted in; the editor is a client-only concern either way.
  useEffect(() => {
    const id = taskIdFromLocation();
    if (id) void resolve(id);
    // Mount only — later param changes arrive via popstate below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back / Forward: out of the editor, or back into it.
  useEffect(() => {
    const onPop = () => {
      const id = taskIdFromLocation();
      if (!id) {
        pushedRef.current = false;
        resolvingRef.current = null;
        setOpenTask(null);
        return;
      }
      if (taskRef.current?.id === id) return;
      void resolve(id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [resolve, setOpenTask]);

  // The editor floats above the view, so a navigation underneath it (a sidebar
  // click, a filter toggle) leaves it standing but writes a URL with no `task`.
  // Re-assert the param so the address bar never lies about what's on screen.
  useEffect(() => {
    if (!task) return;
    if (taskIdFromLocation() === wantedParam(task.id)) return;
    window.history.replaceState(null, "", urlWithTask(task.id));
  }, [pathname, task]);

  const value = useMemo<OpenTaskValue>(
    () => ({ task, open, openById, close }),
    [task, open, openById, close]
  );
  return (
    <OpenTaskContext.Provider value={value}>{children}</OpenTaskContext.Provider>
  );
}

/** The app-wide task editor, or null when rendered outside the provider. */
export function useOpenTask(): OpenTaskValue | null {
  return useContext(OpenTaskContext);
}
