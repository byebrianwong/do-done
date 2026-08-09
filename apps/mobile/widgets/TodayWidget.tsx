import React from 'react';
import { TaskListWidget } from './widget-ui';
import type { WidgetTheme } from './widget-theme';
import { buildTodayGroups } from './widget-layout';
import type { WidgetTasks } from './widget-data';

/**
 * Home-screen widget mirroring the app's Today view: overdue tasks first, then
 * everything scheduled for today plus the focus picks. Resizable — a taller
 * widget spends the extra height on rows saying more, not just on more rows.
 *
 * Tapping the title opens Today, the "+" opens quick-add, a row opens the task,
 * and the ring completes it.
 */
export function TodayWidget({
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
  const groups = data.signedOut ? [] : buildTodayGroups(data.tasks);
  const left = groups.reduce((n, g) => n + g.tasks.length, 0);
  return (
    <TaskListWidget
      title="Today"
      subtitle={`${left} left`}
      tabUri="dodone://today"
      groups={groups}
      width={width}
      height={height}
      signedOut={data.signedOut}
      projects={data.signedOut ? [] : data.projects}
      emptyText="Nothing on your plate 🎉"
      theme={theme}
    />
  );
}
