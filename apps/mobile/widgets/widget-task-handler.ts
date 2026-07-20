import React from 'react';
import type {
  WidgetInfo,
  WidgetTaskHandlerProps,
} from 'react-native-android-widget';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { QuickAddWidget } from './QuickAddWidget';
import { TodayWidget } from './TodayWidget';
import { UpcomingWidget } from './UpcomingWidget';
import { loadWidgetTasks } from './widget-data';
import { getTasksApi } from '@/lib/supabase';

const TASK_LIST_WIDGETS = {
  Today: TodayWidget,
  Upcoming: UpcomingWidget,
} as const;

type TaskListWidgetName = keyof typeof TASK_LIST_WIDGETS;

function isTaskListWidget(name: string): name is TaskListWidgetName {
  return name === 'Today' || name === 'Upcoming';
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const widgetName = props.widgetInfo.widgetName;

  // The Quick Add tile is static — a single "+" that opens the capture sheet.
  if (widgetName === 'QuickAdd') {
    if (
      props.widgetAction === 'WIDGET_ADDED' ||
      props.widgetAction === 'WIDGET_UPDATE'
    ) {
      props.renderWidget(React.createElement(QuickAddWidget));
    }
    return;
  }

  if (!isTaskListWidget(widgetName)) return;

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
        const api = await getTasksApi();
        await api.complete(taskId);
        completed = true;
      } catch {
        // ignore — the re-render below still reflects current server state
      }
    }
  }

  // WIDGET_DELETED has nothing to draw; every other action (add/update/resize/
  // click) re-renders from fresh data.
  if (props.widgetAction === 'WIDGET_DELETED') return;

  const data = await loadWidgetTasks();
  props.renderWidget(
    React.createElement(TASK_LIST_WIDGETS[widgetName], {
      data,
      height: props.widgetInfo.height,
    })
  );

  // Completing from one widget removes the task everywhere, so keep the other
  // task widget (if the user has it) in sync too.
  if (completed) {
    const sibling: TaskListWidgetName =
      widgetName === 'Today' ? 'Upcoming' : 'Today';
    await requestWidgetUpdate({
      widgetName: sibling,
      renderWidget: (info: WidgetInfo) =>
        React.createElement(TASK_LIST_WIDGETS[sibling], {
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
