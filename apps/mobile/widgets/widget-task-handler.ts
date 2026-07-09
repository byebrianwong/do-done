import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
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
  if (
    props.widgetAction === 'WIDGET_CLICK' &&
    props.clickAction === 'COMPLETE_TASK'
  ) {
    const taskId = props.clickActionData?.taskId;
    if (typeof taskId === 'string') {
      try {
        const api = await getTasksApi();
        await api.complete(taskId);
      } catch {
        // ignore — the re-render below still reflects current server state
      }
    }
  }

  // WIDGET_DELETED has nothing to draw; every other action (add/update/resize/
  // click) re-renders from fresh data.
  if (props.widgetAction === 'WIDGET_DELETED') return;

  const data = await loadWidgetTasks();
  const Widget = TASK_LIST_WIDGETS[widgetName];
  props.renderWidget(
    React.createElement(Widget, { data, height: props.widgetInfo.height })
  );
}
