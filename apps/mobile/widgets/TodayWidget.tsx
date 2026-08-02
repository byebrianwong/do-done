import React from 'react';
import { TaskListWidget } from './widget-ui';
import { buildTodayGroups, type WidgetTasks } from './widget-data';

/**
 * Home-screen widget mirroring the app's Today view: overdue tasks first, then
 * everything scheduled for today plus the focus picks. Resizable — taller
 * widgets show more rows. Tapping the title opens Today, the "+" opens quick-add,
 * a row opens the task, and the checkbox completes it.
 */
export function TodayWidget({
  data,
  height,
}: {
  data: WidgetTasks;
  height: number;
}) {
  const groups = data.signedOut ? [] : buildTodayGroups(data.tasks);
  return (
    <TaskListWidget
      title="Today"
      tabUri="dodone://today"
      groups={groups}
      height={height}
      data={data}
      emptyText="Nothing on your plate 🎉"
    />
  );
}
