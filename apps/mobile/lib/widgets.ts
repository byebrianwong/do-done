/**
 * Foreground widget refresh. Home-screen task widgets otherwise only redraw on
 * their ~30-minute `updatePeriodMillis` tick, so a task you complete or add in
 * the app would sit stale on the launcher. Calling `refreshTaskWidgets()` from
 * the task-mutation chokepoint (`invalidateTasks`) re-renders them promptly.
 *
 * Android-only and a no-op in Expo Go — `react-native-android-widget` ships
 * native code that isn't in the Go runtime, so it's lazy-`require`d behind the
 * `IS_EXPO_GO` guard (the pattern from `lib/geofencing.ts`).
 */

import React from 'react';
import { Platform } from 'react-native';
import type { WidgetInfo } from 'react-native-android-widget';
import { IS_EXPO_GO } from '@/lib/runtime';
import type { WidgetTasks } from '@/widgets/widget-data';

type TaskWidgetComponent = (props: {
  data: WidgetTasks;
  height: number;
}) => React.ReactElement;

const DEBOUNCE_MS = 800;
let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * Re-render the Today + Upcoming widgets from fresh data. Debounced so a burst
 * of cache invalidations (a drag reorder, a multi-field autosave) collapses into
 * one fetch + render. Fire-and-forget — never blocks the caller.
 */
export function refreshTaskWidgets(): void {
  if (Platform.OS !== 'android' || IS_EXPO_GO) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void doRefresh();
  }, DEBOUNCE_MS);
}

async function doRefresh(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requestWidgetUpdate } =
      require('react-native-android-widget') as typeof import('react-native-android-widget');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadWidgetTasks } =
      require('@/widgets/widget-data') as typeof import('@/widgets/widget-data');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TodayWidget } =
      require('@/widgets/TodayWidget') as typeof import('@/widgets/TodayWidget');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { UpcomingWidget } =
      require('@/widgets/UpcomingWidget') as typeof import('@/widgets/UpcomingWidget');

    const data = await loadWidgetTasks();
    const byName: Record<'Today' | 'Upcoming', TaskWidgetComponent> = {
      Today: TodayWidget,
      Upcoming: UpcomingWidget,
    };

    await Promise.all(
      (['Today', 'Upcoming'] as const).map((name) =>
        requestWidgetUpdate({
          widgetName: name,
          renderWidget: (info: WidgetInfo) =>
            React.createElement(byName[name], { data, height: info.height }),
          widgetNotFound: () => {
            // No widgets of this name on the home screen — nothing to do.
          },
        })
      )
    );
  } catch {
    // Native module unavailable (Expo Go) or the update failed — ignore.
  }
}
