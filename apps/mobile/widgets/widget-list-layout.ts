/**
 * What the List widget says, for either kind of thing it can be pinned to.
 *
 * One widget, two bodies. A shopping list and a project are both `projects`
 * rows, but they are read differently and the app already draws them
 * differently, so the widget does too rather than averaging them into one
 * shape that is wrong for both:
 *
 * | Pinned to | Grouped by | Ring | Subline |
 * | --- | --- | --- | --- |
 * | a list | aisle, in walking order | the aisle | shops, then the day |
 * | a project | overdue, then the rest | the project | the app's `rowSubline` |
 *
 * Pure and node-tested, like `widget-layout.ts` next door and for the same
 * reason: `apps/mobile` has no renderer, and a widget that groups itself wrong
 * fails silently on a home screen.
 */

import {
  groupByAisle,
  isOverdue,
  listSubline,
  openItems,
  sortByPriority,
  summarizeList,
  type AisleMemory,
  type Task,
} from '@do-done/shared';

import type { WidgetGroup } from './widget-layout';

/**
 * A shopping list, in walking order.
 *
 * **The cart is not drawn.** `groupByAisle` is a route through a shop and the
 * cart is a record of what already happened, so aisle headers over it would
 * imply something was left to walk — the same reason the app's own list screen
 * never groups it. On a launcher cell it would also spend the widget's whole
 * height on rows whose only remaining action is undoing a tick. What the cart
 * gets instead is one word in the subtitle: "3 in the cart".
 *
 * `groupByAisle` collapses to a single unlabelled group when grouping would
 * gain nothing — too few items, or everything in one aisle. `layoutRows` draws
 * no header for a single group, so the two rules meet and a short list renders
 * flat with no special case here.
 */
export function buildListGroups(
  items: Task[],
  memory?: AisleMemory
): WidgetGroup[] {
  const open = openItems(items);
  if (open.length === 0) return [];

  return groupByAisle(open, { memory }).map((group) => ({
    // "Other" is the trailing group nothing was recognised in. It gets a key of
    // its own rather than an empty one, which is what a collapsed single group
    // carries.
    key: group.aisle ?? (group.label ? 'other' : 'items'),
    title: group.label,
    tasks: group.items,
    namesTheDay: false,
    listItems: true,
  }));
}

/**
 * A project's open work: overdue first, then everything else.
 *
 * Deliberately the Today widget's two-group shape rather than the project
 * screen's status columns. `applyDisplay` emits a column per status even when
 * empty, on purpose — they are drop targets — and a launcher cell has neither
 * the height for five headings nor anything to drop onto. What survives of the
 * screen is the thing worth seeing at a glance: what is late, and what is left.
 *
 * Neither group names a day, so the rows keep their dates. That is most of why
 * someone pins a project to their home screen — a project widget that hid its
 * dates would be a list of titles.
 */
export function buildProjectGroups(tasks: Task[], now?: Date): WidgetGroup[] {
  const open = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled'
  );
  if (open.length === 0) return [];

  const overdue = open.filter((t) => isOverdue(t, now));
  const overdueIds = new Set(overdue.map((t) => t.id));
  const rest = open.filter((t) => !overdueIds.has(t.id));

  const groups: WidgetGroup[] = [];
  if (overdue.length) {
    groups.push({
      key: 'overdue',
      title: 'Overdue',
      tasks: sortByPriority(overdue),
      namesTheDay: false,
      hideProject: true,
    });
  }
  if (rest.length) {
    groups.push({
      key: 'todo',
      title: 'To do',
      tasks: sortByPriority(rest),
      namesTheDay: false,
      hideProject: true,
    });
  }
  return groups;
}

/**
 * The line beside the widget's title.
 *
 * A list borrows `listSubline`, the same sentence the Lists index and the
 * sidebar print, so a widget and the screen it mirrors cannot count
 * differently — "8 items · 3 in the cart", and "Nothing on it" rather than
 * "0 items", because empty is a shopping list's resting state and not a number
 * worth printing.
 *
 * A project says what is left, matching the Today widget's "5 left".
 */
export function listWidgetSubtitle(input: {
  isList: boolean;
  tasks: Task[];
}): string {
  if (input.isList) {
    return listSubline(summarizeList(input.tasks));
  }
  const open = input.tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled'
  );
  return open.length === 0 ? '' : `${open.length} left`;
}
