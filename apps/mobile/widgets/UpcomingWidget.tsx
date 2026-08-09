import React from 'react';
import { TaskListWidget } from './widget-ui';
import type { WidgetTheme } from './widget-theme';
import { buildUpcomingGroups } from './widget-layout';
import type { WidgetTasks } from './widget-data';

/**
 * Home-screen widget mirroring the app's Upcoming view: tasks grouped by day
 * (Overdue → Today → Tomorrow → next days → Later → Anytime). Resizable —
 * taller widgets show more days and rows.
 *
 * Because every group header names a day, the rows beneath one don't repeat it:
 * a task under "Tomorrow" prints its time, not the word "Tomorrow".
 */
export function UpcomingWidget({
  data,
  width,
  height,
  theme,
}: {
  data: WidgetTasks;
  width: number;
  height: number;
  theme: WidgetTheme;
}) {
  const groups = data.signedOut ? [] : buildUpcomingGroups(data.tasks);
  return (
    <TaskListWidget
      title="Upcoming"
      subtitle="next 7 days"
      tabUri="dodone://upcoming"
      groups={groups}
      width={width}
      height={height}
      signedOut={data.signedOut}
      projects={data.signedOut ? [] : data.projects}
      emptyText="Nothing coming up ✨"
      theme={theme}
    />
  );
}
