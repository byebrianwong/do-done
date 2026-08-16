"use client";

/**
 * Window event announcing that a task's place reminders changed.
 *
 * The editor's location section owns its own data — it loads links for one
 * task and writes them straight through, like the attachments section beside
 * it. But a *list* also draws a pin on every row that has a reminder, and that
 * badge is fed by one query for the whole account (`LocationLinksProvider`).
 * Those two live at opposite ends of the tree with no prop path between them,
 * and the editor is a layer over whatever page happens to be underneath.
 *
 * So the section says what it did, and the provider refetches. Nothing depends
 * on the event arriving: a badge that misses it is stale until the next page
 * load, which is where it was before this existed.
 */
export const TASK_LOCATIONS_CHANGED_EVENT = "do-done:task-locations-changed";

/** Tell any list badge that its picture of the links is now out of date. */
export function announceLocationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TASK_LOCATIONS_CHANGED_EVENT));
}
