/**
 * Where a tapped notification lands.
 *
 * Pure, so the node suite can cover it — the routing is the half of a
 * notification that a device test would catch and CI never will, and getting it
 * wrong is invisible: the app opens, just not on the thing the notification was
 * about.
 *
 * A notification that opens the app on whatever screen it happened to be
 * showing has thrown away the one piece of information it was carrying. The
 * location reminder in particular had no handler at all — you arrived at the
 * shop, the phone told you about "Buy milk", you tapped it, and got the Today
 * list with no idea which task it meant.
 */

export interface NotificationPayload {
  kind?: unknown;
  taskId?: unknown;
  digest?: unknown;
}

/**
 * The in-app path for a notification's `data`, or null when there is nothing
 * better to do than leave the app where it is.
 *
 * Null rather than a default route on purpose: a notification from an older
 * build, or one this version doesn't recognise, should not yank someone off
 * the screen they were on to guess at a destination.
 */
export function routeForNotification(
  data: NotificationPayload | null | undefined
): string | null {
  if (!data) return null;

  // A location reminder names its task, which is the whole point — the
  // notification body is a task title, and tapping it should open that task.
  if (typeof data.taskId === 'string' && data.taskId.length > 0) {
    return `/task/${data.taskId}`;
  }

  if (data.kind === 'digest') {
    // The weekly digest is a shape of the days ahead, so it opens the view
    // that draws days. The daily one is a list of today, so it opens Today.
    return data.digest === 'weekly' ? '/upcoming' : '/today';
  }

  return null;
}
