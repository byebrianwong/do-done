import React from 'react';
import { rowGutter, rowSubline } from '@do-done/shared';
import { NextUpWidget as NextUpCard } from './widget-ui';
import type { WidgetTheme } from './widget-theme';
import { buildNextUp } from './widget-layout';
import type { WidgetTasks } from './widget-data';

/**
 * The 4×1 strip: one task, and the count of what's behind it.
 *
 * It answers the only question a glance at a home screen asks, in a shape that
 * sits flush with a row of app icons. The task is the head of the Today
 * universe rather than a fresh ranking, so it can never disagree with a Today
 * widget on the same screen.
 *
 * No group header names the day here, so the subline keeps its date — for the
 * usual case that date is today and `rowSubline` prints only the time anyway.
 */
export function NextUpWidget({
  data,
  theme,
}: {
  data: WidgetTasks;
  /** Part of the shared task-widget signature; a strip is one row at any size. */
  width?: number;
  height?: number;
  theme: WidgetTheme;
}) {
  if (data.signedOut) {
    return (
      <NextUpCard
        task={null}
        project={null}
        gutter={null}
        subline=""
        remaining={0}
        signedOut
        theme={theme}
      />
    );
  }

  const { task, remaining } = buildNextUp(data.tasks);
  const project = task?.project_id
    ? data.projects.find((p) => p.id === task.project_id) ?? null
    : null;

  return (
    <NextUpCard
      task={task}
      project={project}
      gutter={task ? rowGutter(task) : null}
      subline={
        task ? rowSubline(task, { projectName: project?.name ?? null }).join(' · ') : ''
      }
      remaining={remaining}
      signedOut={false}
      theme={theme}
    />
  );
}
