/**
 * The one way `lib/` reaches the toast.
 *
 * The status ↔ schedule rule changes tasks the user did not ask it to — a task
 * re-dated to tomorrow moves to Next, and a task whose day comes near moves on
 * its own. An automatic move that says nothing is indistinguishable from the
 * app losing the edit, which is exactly how this feature read as a bug.
 *
 * Both of the places that need to say so — `updateTask`/`createTask` in
 * `task-queries.ts` and the sweep in `status-sync.ts` — are plain modules, not
 * components, so neither can call `useUndoToast`. The root sets this once and
 * clears it on unmount; before it is set, and after a sign-out, notices are
 * dropped rather than queued. A toast about a write that happened before there
 * was a screen to show it on has nothing useful to say by the time there is.
 */

type Notifier = (message: string) => void;

let notifier: Notifier | null = null;

/** Point notices at the live toast. Returns the teardown. */
export function setAutoSyncNotifier(next: Notifier): () => void {
  notifier = next;
  return () => {
    // Only clear if it is still ours: a remount can install the new one before
    // the old one's cleanup runs, and clearing then would leave nothing set.
    if (notifier === next) notifier = null;
  };
}

/** Show one line about an automatic change, if anything is listening. */
export function notifyAutoSync(message: string | null | undefined): void {
  if (message) notifier?.(message);
}
