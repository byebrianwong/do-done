/**
 * Which home-screen widgets a refresh has to redraw.
 *
 * `refreshTaskWidgets()` runs after every write, through `invalidateTasks()`.
 * It used to read the task list first and only then ask the launcher which
 * widgets were placed, so a phone with no widgets paid for a task read after
 * every tick. The refresh now asks first and skips what nobody has placed.
 *
 * The Today, Upcoming and Next up widgets share one task read. The List widget
 * reads its own pinned list (`widgets/widget-list-data.ts`), so it is decided
 * separately: a phone with only a List widget skips the shared read.
 */
import { TASK_WIDGET_NAMES } from '@/widgets/widget-render';

/** `LIST_WIDGET_NAME` in `widgets/widget-list-data.ts`. Pinned by the test. */
export const LIST_WIDGET = 'List';

/** Every widget a refresh may redraw. The Quick Add tile is not one. */
export const REFRESHED_WIDGET_NAMES: readonly string[] = [
  ...TASK_WIDGET_NAMES,
  LIST_WIDGET,
];

export interface WidgetRefreshPlan {
  /** Read the shared task list and redraw Today, Upcoming and Next up. */
  tasks: boolean;
  /** Redraw the List widgets. */
  lists: boolean;
}

export function widgetRefreshPlan(placed: ReadonlySet<string>): WidgetRefreshPlan {
  return {
    tasks: TASK_WIDGET_NAMES.some((name) => placed.has(name)),
    lists: placed.has(LIST_WIDGET),
  };
}
