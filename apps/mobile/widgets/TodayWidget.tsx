import React from 'react';
import { FlexWidget, IconWidget, TextWidget } from 'react-native-android-widget';
import { PRIORITY_CONFIG } from '@do-done/shared';
import type { Task, TaskPriority } from '@do-done/shared';

interface TodayWidgetProps {
  tasks?: Task[];
}

// Cast helper for HexColor template literal type
function hex(color: string): `#${string}` {
  return color as `#${string}`;
}

/**
 * Home-screen widget showing today's top tasks.
 * Tapping anywhere opens the app to /today.
 */
export function TodayWidget({ tasks = [] }: TodayWidgetProps) {
  const top = tasks.slice(0, 4);

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        borderRadius: 16,
        backgroundColor: '#ffffff',
        padding: 12,
        flexDirection: 'column',
      }}
      clickAction="OPEN_APP"
      clickActionData={{ deepLink: 'dodone://today' }}
    >
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <TextWidget
          text="Today"
          style={{ color: '#111827', fontSize: 14, fontWeight: '700' }}
        />
        <IconWidget
          font="material"
          icon="add"
          size={18}
          style={{ color: '#6366f1' }}
        />
      </FlexWidget>

      {top.length === 0 ? (
        <TextWidget
          text="Nothing on your plate"
          style={{ color: '#9ca3af', fontSize: 12 }}
        />
      ) : (
        top.map((task) => (
          <FlexWidget
            key={task.id}
            style={{
              width: 'match_parent',
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 6,
            }}
          >
            <FlexWidget
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: hex(
                  PRIORITY_CONFIG[task.priority as TaskPriority].color
                ),
                marginRight: 8,
              }}
            />
            <TextWidget
              text={task.title}
              maxLines={1}
              truncate="END"
              style={{ color: '#1f2937', fontSize: 13 }}
            />
          </FlexWidget>
        ))
      )}
    </FlexWidget>
  );
}
