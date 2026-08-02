import React from 'react';
import { TaskListWidget } from './widget-ui';
import { buildUpcomingGroups, type WidgetTasks } from './widget-data';

/**
 * Home-screen widget mirroring the app's Upcoming view: tasks grouped by day
 * (Overdue → Today → Tomorrow → next days → Later → Anytime). Resizable — taller
 * widgets show more days and rows. Tapping the title opens Upcoming, the "+"
 * opens quick-add, a row opens the task, and the checkbox completes it.
 */
export function UpcomingWidget({
  data,
  height,
}: {
  data: WidgetTasks;
  height: number;
}) {
  const groups = data.signedOut ? [] : buildUpcomingGroups(data.tasks);
  return (
    <TaskListWidget
      title="Upcoming"
      tabUri="dodone://upcoming"
      groups={groups}
      height={height}
      data={data}
      emptyText="Nothing coming up ✨"
    />
  );
}
