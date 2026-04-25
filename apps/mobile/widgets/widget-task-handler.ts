import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { QuickAddWidget } from './QuickAddWidget';
import { TodayWidget } from './TodayWidget';
import { supabase } from '@/lib/supabase';
import { TasksApi } from '@do-done/api-client';
import { generateFocusList } from '@do-done/task-engine';
import type { Task } from '@do-done/shared';

const NAME_TO_WIDGET = {
  QuickAdd: QuickAddWidget,
  Today: TodayWidget,
} as const;

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const widgetName = props.widgetInfo.widgetName as keyof typeof NAME_TO_WIDGET;

  if (widgetName === 'QuickAdd') {
    if (
      props.widgetAction === 'WIDGET_ADDED' ||
      props.widgetAction === 'WIDGET_UPDATE'
    ) {
      props.renderWidget(React.createElement(QuickAddWidget));
    }
    return;
  }

  if (widgetName === 'Today') {
    if (
      props.widgetAction === 'WIDGET_ADDED' ||
      props.widgetAction === 'WIDGET_UPDATE' ||
      props.widgetAction === 'WIDGET_RESIZED'
    ) {
      let tasks: Task[] = [];
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const api = new TasksApi(supabase, user.id);
          const { data } = await api.list({ limit: 100, offset: 0 });
          tasks = generateFocusList(data, 4);
        }
      } catch {
        // ignore — widget will render empty state
      }
      props.renderWidget(React.createElement(TodayWidget, { tasks }));
    }
  }
}
