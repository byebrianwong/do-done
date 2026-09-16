/**
 * The one JS entry point the launcher calls to draw a widget. Registered as a
 * headless task from `index.js` — see the comment there for why it can't be
 * registered from a component.
 *
 * It runs in a JS context with no activity and no React tree, often with the app
 * otherwise dead, so the module graph reachable from this file's *static*
 * imports is everything that has to load before anything can be drawn. The
 * static half is deliberately tiny: React, and the Quick Add tile (whose only
 * dependency is a module that builds SVG strings). Supabase, the API client and
 * the task engine come in behind `await import(...)`, on the branch that
 * actually needs them, so a failure to construct the Supabase client can't take
 * the static tile down with it.
 */

import React from 'react';
import type {
  WidgetInfo,
  WidgetTaskHandlerProps,
} from 'react-native-android-widget';
import { QuickAddWidget } from './QuickAddWidget';
import { CLEAR_LIST_TARGET, COMPLETE_TASK, SET_LIST_TARGET } from './widget-actions';
import type { WidgetTasks } from './widget-data';
import type { TaskWidgetComponent, TaskWidgetName } from './widget-render';

/**
 * The List widget's name, inlined rather than imported from
 * `widget-list-data.ts` — that module pulls in Supabase, and this file's static
 * graph is what a cold, appless launcher update has to evaluate before anything
 * can be drawn. `widget-list-handler.test.ts` pins the two together.
 */
const LIST_WIDGET = 'List';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const widgetName = props.widgetInfo.widgetName;

  // WIDGET_DELETED has nothing to draw. Every other action — added, updated,
  // resized, clicked — ends in a render.
  if (props.widgetAction === 'WIDGET_DELETED') {
    // A List widget's pinned list is stored against its widget id, and the
    // launcher reuses ids. Left behind, a stale pin means the next widget that
    // happens to get this id opens on someone else's list instead of asking.
    if (widgetName === LIST_WIDGET) {
      const { forgetTarget } = await import('./widget-target');
      await forgetTarget(props.widgetInfo.widgetId);
    }
    return;
  }

  // The Quick Add tile is static: one "+" that opens the capture sheet. It is
  // drawn for every action rather than just add/update, because it has
  // `updatePeriodMillis: 0` — an action it declines to draw for is a tile that
  // stays as it was, and "as it was" for a fresh widget is blank.
  if (widgetName === 'QuickAdd') {
    props.renderWidget(
      React.createElement(QuickAddWidget, {
        width: props.widgetInfo.width,
        height: props.widgetInfo.height,
      })
    );
    return;
  }

  if (widgetName === LIST_WIDGET) {
    await renderListWidget(props);
    return;
  }

  // Everything past here needs the data layer, so the name check comes from the
  // module that owns the list — loaded lazily like everything else on this path.
  const { isTaskWidgetName } = await import('./widget-render');
  if (!isTaskWidgetName(widgetName)) return;
  await renderTaskWidget(widgetName, props);
}

/**
 * The List widget: pick a list, or draw the one already pinned.
 *
 * Three clicks reach here. `SET_LIST_TARGET` answers the picker's question,
 * `CLEAR_LIST_TARGET` re-asks it, and `COMPLETE_TASK` ticks a row off. Each one
 * writes first and then falls through to the render below, so the widget always
 * redraws from the state the tap just produced rather than the state it had.
 */
async function renderListWidget(props: WidgetTaskHandlerProps) {
  const widgetId = props.widgetInfo.widgetId;
  let completed = false;

  if (props.widgetAction === 'WIDGET_CLICK') {
    const { forgetTarget, writeTarget } = await import('./widget-target');
    if (props.clickAction === SET_LIST_TARGET) {
      const projectId = props.clickActionData?.projectId;
      if (typeof projectId === 'string') await writeTarget(widgetId, projectId);
    } else if (props.clickAction === CLEAR_LIST_TARGET) {
      await forgetTarget(widgetId);
    } else if (props.clickAction === COMPLETE_TASK) {
      completed = await completeTask(props.clickActionData?.taskId);
    }
  }

  const [{ loadListWidget }, { ListWidget }, { themedPairOf }] = await Promise.all([
    import('./widget-list-data'),
    import('./ListWidget'),
    import('./widget-render'),
  ]);

  const data = await loadListWidget(widgetId);
  props.renderWidget(
    themedPairOf(ListWidget, {
      data,
      width: props.widgetInfo.width,
      height: props.widgetInfo.height,
    })
  );

  // Ticking a project's task off here removes it from Today as well, so keep
  // whichever task widgets are on the home screen in step. A shopping item is
  // in none of them, but the write has already landed either way and a
  // redundant redraw is cheaper than working out whether it was one.
  if (completed) await refreshTaskWidgets();
}

/** Tick a task off from a widget. Reports whether anything was written. */
async function completeTask(taskId: unknown): Promise<boolean> {
  if (typeof taskId !== 'string') return false;
  try {
    const { getTasksApi } = await import('@/lib/supabase');
    const api = await getTasksApi();
    await api.complete(taskId);
    return true;
  } catch {
    // The re-render that follows still reflects current server state.
    return false;
  }
}

/** Redraw every task widget on the home screen from one fresh read. */
async function refreshTaskWidgets() {
  try {
    const [mods, { requestWidgetUpdate }] = await Promise.all([
      loadTaskWidgetModules(),
      import('react-native-android-widget'),
    ]);
    const data = await mods.loadWidgetTasks();
    for (const name of mods.names) {
      await requestWidgetUpdate({
        widgetName: name,
        renderWidget: (info: WidgetInfo) => draw(name, mods, data, info),
        widgetNotFound: () => {
          // that widget isn't on the home screen — nothing to update
        },
      }).catch(() => {
        // best-effort — a sibling failing must never fail the primary render
      });
    }
  } catch {
    // ignore — the widget that was tapped has already been redrawn
  }
}

/** Everything the task widgets need, loaded only on the branch that needs it. */
async function loadTaskWidgetModules() {
  const [data, render, today, upcoming, nextUp] = await Promise.all([
    import('./widget-data'),
    import('./widget-render'),
    import('./TodayWidget'),
    import('./UpcomingWidget'),
    import('./NextUpWidget'),
  ]);
  const components: Record<TaskWidgetName, TaskWidgetComponent> = {
    Today: today.TodayWidget,
    Upcoming: upcoming.UpcomingWidget,
    NextUp: nextUp.NextUpWidget,
  };
  return {
    loadWidgetTasks: data.loadWidgetTasks,
    names: render.TASK_WIDGET_NAMES,
    themedPair: render.themedPair,
    components,
  };
}

type TaskWidgetModules = Awaited<ReturnType<typeof loadTaskWidgetModules>>;

function draw(
  name: TaskWidgetName,
  mods: TaskWidgetModules,
  data: WidgetTasks,
  info: { width: number; height: number }
) {
  return mods.themedPair(mods.components[name], data, info);
}

async function renderTaskWidget(
  widgetName: TaskWidgetName,
  props: WidgetTaskHandlerProps
) {
  const mods = await loadTaskWidgetModules();

  // A tapped ring completes the task in the background, then falls through to
  // re-render this widget with the task removed from the list.
  const completed =
    props.widgetAction === 'WIDGET_CLICK' && props.clickAction === COMPLETE_TASK
      ? await completeTask(props.clickActionData?.taskId)
      : false;

  const data = await mods.loadWidgetTasks();
  props.renderWidget(draw(widgetName, mods, data, props.widgetInfo));

  // Completing from one widget removes the task everywhere, so keep whichever
  // of the others the user has on their home screen in step too.
  if (!completed) return;

  const { requestWidgetUpdate } = await import('react-native-android-widget');
  for (const sibling of mods.names) {
    if (sibling === widgetName) continue;
    await requestWidgetUpdate({
      widgetName: sibling,
      renderWidget: (info: WidgetInfo) => draw(sibling, mods, data, info),
      widgetNotFound: () => {
        // that widget isn't on the home screen — nothing to update
      },
    }).catch(() => {
      // best-effort — never fail the primary render because of a sibling
    });
  }

  // A List widget pinned to a project is showing the task that just went, and
  // `renderWidget` here may return a promise, so each one re-resolves its own
  // pin rather than being handed a list it might not be pinned to.
  await refreshListWidgets();
}

/** Redraw every List widget, each against whatever it is pinned to. */
async function refreshListWidgets() {
  try {
    const [
      { createListWidgetLoader },
      { ListWidget },
      { themedPairOf },
      { requestWidgetUpdate },
    ] = await Promise.all([
      import('./widget-list-data'),
      import('./ListWidget'),
      import('./widget-render'),
      import('react-native-android-widget'),
    ]);
    // One loader across the sweep: two List widgets pinned to the same list
    // cost one query, and the project list is read once however many there are.
    const loader = createListWidgetLoader();
    await requestWidgetUpdate({
      widgetName: LIST_WIDGET,
      renderWidget: async (info: WidgetInfo) =>
        themedPairOf(ListWidget, {
          data: await loader.load(info.widgetId),
          width: info.width,
          height: info.height,
        }),
      widgetNotFound: () => {
        // no List widgets on the home screen — nothing to update
      },
    });
  } catch {
    // best-effort, as above
  }
}
