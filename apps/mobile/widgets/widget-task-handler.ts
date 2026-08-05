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

const TASK_LIST_WIDGET_NAMES = ['Today', 'Upcoming'] as const;

type TaskListWidgetName = (typeof TASK_LIST_WIDGET_NAMES)[number];

function isTaskListWidget(name: string): name is TaskListWidgetName {
  return (TASK_LIST_WIDGET_NAMES as readonly string[]).includes(name);
}

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

  if (!isTaskListWidget(widgetName)) return;
  await renderTaskListWidget(widgetName, props);
}

async function renderTaskListWidget(
  widgetName: TaskListWidgetName,
  props: WidgetTaskHandlerProps
) {
  const [{ loadWidgetTasks }, { TodayWidget }, { UpcomingWidget }] =
    await Promise.all([
      import('./widget-data'),
      import('./TodayWidget'),
      import('./UpcomingWidget'),
    ]);

  const components = {
    Today: TodayWidget,
    Upcoming: UpcomingWidget,
  } as const;

  // A tapped checkbox completes the task in the background, then falls through
  // to re-render this widget with the task removed from the list.
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

  const data = await loadWidgetTasks();
  props.renderWidget(
    React.createElement(components[widgetName], {
      data,
      height: props.widgetInfo.height,
    })
  );

  // Completing from one widget removes the task everywhere, so keep the other
  // task widget (if the user has it) in sync too.
  if (completed) {
    const sibling: TaskListWidgetName =
      widgetName === 'Today' ? 'Upcoming' : 'Today';
    const { requestWidgetUpdate } = await import('react-native-android-widget');
    await requestWidgetUpdate({
      widgetName: sibling,
      renderWidget: (info: WidgetInfo) =>
        React.createElement(components[sibling], {
          data,
          height: info.height,
        }),
      widgetNotFound: () => {
        // sibling widget isn't on the home screen — nothing to update
      },
    }).catch(() => {
      // best-effort — never fail the primary render because of the sibling
    });
  }
}
