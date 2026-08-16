/**
 * The shape a location reminder takes once it is on a task, and the words both
 * apps use to describe it.
 *
 * `task_locations` is three columns — task, place, direction — so a link on its
 * own says nothing a person can read. What every surface actually wants is the
 * place *joined on*, which is what `TaskLocationLink` is. Keeping the type and
 * the phrasing here rather than in either app is what stops "Arriving at Tesco"
 * on the phone from reading "Enter: Tesco" on the laptop.
 */

import type { Location, TriggerType } from "./schemas.js";

/** A location link as an editor needs it: the place plus the direction. */
export interface TaskLocationLink {
  location: Location;
  trigger_type: TriggerType;
}

/** A link that also remembers which task it belongs to — the batch read. */
export interface TaskLocationLinkRow extends TaskLocationLink {
  task_id: string;
}

/** "Arriving" / "Leaving" — the only two words either app uses for a trigger. */
export const TRIGGER_LABELS: Record<TriggerType, string> = {
  enter: "Arriving",
  exit: "Leaving",
};

/** Attaching a place means "remind me when I get there" until told otherwise. */
export const DEFAULT_TRIGGER: TriggerType = "enter";

/**
 * One-line summary of a task's location reminders for a folded row.
 *
 * Names the place while there's only one, since "Arriving at Tesco" is the
 * whole setting at a glance; past that, counting is the only thing that fits.
 */
export function locationReminderLabel(links: TaskLocationLink[]): string {
  if (links.length === 0) return "Remind me at a place";
  if (links.length === 1) {
    const { location, trigger_type } = links[0];
    return trigger_type === "enter"
      ? `Arriving at ${location.name}`
      : `Leaving ${location.name}`;
  }
  const places = new Set(links.map((l) => l.location.id)).size;
  return places === 1
    ? `Arriving at and leaving ${links[0].location.name}`
    : `${places} places`;
}

/**
 * The shortest true thing a task *row* can say about its reminders — a place
 * name, or a count once naming one would be a lie about the rest.
 *
 * Deliberately shorter than `locationReminderLabel`: a row has one line for
 * everything a task is, and the direction is the part a reader can infer or go
 * and check. The editor's folded row has the width to say it, so it does.
 */
export function locationRowLabel(links: TaskLocationLink[]): string | null {
  if (links.length === 0) return null;
  const places = new Set(links.map((l) => l.location.id));
  if (places.size === 1) return links[0].location.name;
  return `${places.size} places`;
}

/**
 * Group a batch read by task, so a list can ask "does this row have a
 * reminder?" without a query per row.
 */
export function groupLinksByTask(
  rows: TaskLocationLinkRow[]
): Map<string, TaskLocationLink[]> {
  const byTask = new Map<string, TaskLocationLink[]>();
  for (const { task_id, ...link } of rows) {
    const existing = byTask.get(task_id);
    if (existing) existing.push(link);
    else byTask.set(task_id, [link]);
  }
  return byTask;
}
