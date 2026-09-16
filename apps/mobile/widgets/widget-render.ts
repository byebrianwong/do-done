/**
 * The light/dark pair every task widget is drawn as, in one place.
 *
 * Two callers reach for this and they must not drift: the launcher's headless
 * handler (`widget-task-handler.ts`) and the app's own foreground refresh
 * (`lib/widgets.ts`). A widget redrawn from inside the app with only a light
 * tree would silently lose its dark card until the next 30-minute tick — the
 * kind of bug that only reproduces on someone else's phone.
 *
 * `react-native-android-widget` accepts `renderWidget({ light, dark })` and
 * picks by the system theme, so a dark home screen costs one extra render of
 * the same tree. Nothing but the colour table differs between them.
 *
 * Statically imports nothing but React and the colour tables — the widget
 * components (and through them Supabase) stay the caller's business, because
 * this module is on the path a cold, appless launcher update takes.
 */

import React from 'react';
import { DARK_THEME, LIGHT_THEME, type WidgetTheme } from './widget-theme';
import type { WidgetTasks } from './widget-data';

export const TASK_WIDGET_NAMES = ['Today', 'Upcoming', 'NextUp'] as const;

export type TaskWidgetName = (typeof TASK_WIDGET_NAMES)[number];

export function isTaskWidgetName(name: string): name is TaskWidgetName {
  return (TASK_WIDGET_NAMES as readonly string[]).includes(name);
}

/**
 * Every task widget takes the same four things, so they can be treated as one
 * kind. `NextUp` ignores the size — a strip is one row wide at any width — but
 * still accepts it rather than being special-cased by every caller.
 */
export interface TaskWidgetProps {
  data: WidgetTasks;
  width: number;
  height: number;
  theme: WidgetTheme;
}

export type TaskWidgetComponent = React.ComponentType<TaskWidgetProps>;

/**
 * Render a themed component twice — once per colour table — for the launcher to
 * pick between.
 *
 * Generic over the props, because the List widget's data is not `WidgetTasks`:
 * a shopping list's items are exactly the rows `TasksApi.read()` filters out,
 * so it cannot be drawn from the sweep the other four share. What every widget
 * *does* share is that the theme is an argument to one tree, and that is what
 * this enforces.
 */
export function themedPairOf<P extends { theme: WidgetTheme }>(
  Component: React.ComponentType<P>,
  props: Omit<P, 'theme'>
) {
  return {
    light: React.createElement(Component, { ...props, theme: LIGHT_THEME } as P),
    dark: React.createElement(Component, { ...props, theme: DARK_THEME } as P),
  };
}

export function themedPair(
  Component: TaskWidgetComponent,
  data: WidgetTasks,
  info: { width: number; height: number }
) {
  return themedPairOf(Component, {
    data,
    width: info.width,
    height: info.height,
  });
}
