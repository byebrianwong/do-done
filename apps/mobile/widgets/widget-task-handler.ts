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
import type { WidgetTasks } from './widget-data';
import type { TaskWidgetComponent, TaskWidgetName } from './widget-render';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const widgetName = props.widgetInfo.widgetName;

  // WIDGET_DELETED has nothing to draw. Every other action — added, updated,
  // resized, clicked — ends in a render.
  if (props.widgetAction === 'WIDGET_DELETED') return;

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

  // Everything past here needs the data layer, so the name check comes from the
  // module that owns the list — loaded lazily like everything else on this path.
  const { isTaskWidgetName } = await import('./widget-render');
  if (!isTaskWidgetName(widgetName)) return;
  await renderTaskWidget(widgetName, props);
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
  let completed = false;
  if (
    props.widgetAction === 'WIDGET_CLICK' &&
    props.clickAction === 'COMPLETE_TASK'
  ) {
    const taskId = props.clickActionData?.taskId;
    if (typeof taskId === 'string') {
      try {
        const { getTasksApi } = await import('@/lib/supabase');
        const api = await getTasksApi();
        await api.complete(taskId);
        completed = true;
      } catch {
        // ignore — the re-render below still reflects current server state
      }
    }
  }

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
}
