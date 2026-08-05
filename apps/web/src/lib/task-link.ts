/**
 * Links to a single task.
 *
 * Two URL shapes point at the same task, and they answer different questions:
 *
 *   /task/<id>            the canonical, context-free address. This is what
 *                         every "Copy link" affordance hands out, and what a
 *                         recipient opens: a standalone page for that task.
 *   /today?task=<id>      the modal, mirrored onto whatever view it was opened
 *                         from. The address bar carries this while the editor
 *                         is up, so copying the URL shares the task too, and
 *                         Back closes the modal instead of leaving the view.
 *
 * Both resolve to the same task; the query form just preserves the surrounding
 * list, which is the thing the modal exists to keep.
 */

/** Search param that mirrors an open task modal onto the current URL. */
export const TASK_PARAM = "task";

/** Canonical path for a single task, independent of the current view. */
export function taskPath(id: string): string {
  return `/task/${id}`;
}

/** Absolute link to a task, for handing to someone else. */
export function taskShareUrl(id: string): string {
  if (typeof window === "undefined") return taskPath(id);
  return `${window.location.origin}${taskPath(id)}`;
}

/**
 * Copy a task's share link to the clipboard. Resolves false when the clipboard
 * is unavailable (insecure context) or the write is refused, so callers can
 * say so rather than silently claiming success.
 */
export async function copyTaskLink(id: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(taskShareUrl(id));
    return true;
  } catch (e) {
    console.error("Copy link failed:", e);
    return false;
  }
}

/** True for ⇧⌘C / Shift+Ctrl+C — the copy-link shortcut the menus advertise. */
export function isCopyLinkShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "c";
}
