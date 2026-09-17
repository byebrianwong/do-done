import React from 'react';
import { ListPickerWidget, TaskListWidget } from './widget-ui';
import type { WidgetTheme } from './widget-theme';
import {
  buildListGroups,
  buildProjectGroups,
  listWidgetSubtitle,
} from './widget-list-layout';
import type { ListWidgetData } from './widget-list-data';

/**
 * Everything in one list, on the home screen.
 *
 * The same card the Today widget draws — a title, a count, rows with a ring and
 * a gutter, a tick that completes — pointed at a list or a project you pick
 * rather than at a day. That is the whole idea: the shopping list you keep and
 * the project you are in the middle of are the two things a launcher cell is
 * worth spending on, and neither of them is a date.
 *
 * Three states, and the widget can be in any of them at any size:
 *
 * - **signed out** — the prompt every widget shows.
 * - **unpinned** — the picker. See `widget-target.ts` for why the pick lives
 *   against the widget's own id rather than in the database.
 * - **pinned** — the list. Tapping the title opens it in the app, the swap
 *   arrows re-open the picker, and "+" captures into the app as everywhere else.
 *
 * What the body looks like depends on which kind of thing is pinned, and both
 * shapes are decided in `widget-list-layout.ts`: a shopping list groups by
 * aisle with the aisle in the ring, a project puts what is late first with the
 * project in the ring.
 */
export function ListWidget({
  data,
  width,
  height,
  theme,
}: {
  data: ListWidgetData;
  width: number;
  height: number;
  theme: WidgetTheme;
}) {
  if (data.state === 'signed-out') {
    return (
      <TaskListWidget
        title="List"
        subtitle=""
        tabUri="dodone://lists"
        groups={[]}
        width={width}
        height={height}
        signedOut
        projects={[]}
        emptyText=""
        theme={theme}
      />
    );
  }

  if (data.state === 'pick') {
    return (
      <ListPickerWidget
        candidates={data.candidates}
        height={height}
        theme={theme}
      />
    );
  }

  const { project, isList, tasks, aisleMemory } = data;
  const groups = isList
    ? buildListGroups(tasks, aisleMemory)
    : buildProjectGroups(tasks);

  return (
    <TaskListWidget
      title={project.name}
      subtitle={listWidgetSubtitle({ isList, tasks })}
      // `(tabs)` is a route group, so these are the app's own URLs unchanged.
      tabUri={`dodone://${isList ? 'lists' : 'projects'}/${project.id}`}
      groups={groups}
      width={width}
      height={height}
      signedOut={false}
      projects={[project]}
      // A finished shopping list is a normal resting state and a finished
      // project is an achievement, so they do not say the same thing.
      emptyText={isList ? 'Nothing left to get 🛒' : 'Nothing left here 🎉'}
      swappable
      // An empty list with a full cart still has "3 in the cart" to report, and
      // that is the sentence that says there is something to put away.
      keepSubtitleWhenEmpty={isList}
      aisleMemory={aisleMemory}
      theme={theme}
    />
  );
}
