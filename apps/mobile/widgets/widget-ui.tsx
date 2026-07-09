import React from 'react';
import { FlexWidget, IconWidget, TextWidget } from 'react-native-android-widget';
import { PRIORITY_CONFIG } from '@do-done/shared';
import type { Task, TaskPriority } from '@do-done/shared';
import {
  flattenGroups,
  rowCapacity,
  type WidgetGroup,
  type WidgetTasks,
} from './widget-data';

// Cast helper for the library's `#${string}` HexColor template-literal type.
function hex(color: string): `#${string}` {
  return color as `#${string}`;
}

const INDIGO = '#6366f1';
const QUICK_ADD_URI = 'dodone://quick-add';

/** Top bar: the view name (opens its tab) + a "+" that opens quick-add. */
function WidgetHeader({ title, tabUri }: { title: string; tabUri: string }) {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
      }}
    >
      <TextWidget
        text={title}
        clickAction="OPEN_URI"
        clickActionData={{ uri: tabUri }}
        style={{ color: '#111827', fontSize: 15, fontWeight: '700' }}
      />
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: QUICK_ADD_URI }}
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: '#eef2ff',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconWidget font="material" icon="add" size={18} style={{ color: INDIGO }} />
      </FlexWidget>
    </FlexWidget>
  );
}

/** Small caps section label with a count, red for the Overdue group. */
function GroupHeader({
  title,
  count,
  overdue,
}: {
  title: string;
  count: number;
  overdue: boolean;
}) {
  const color = overdue ? '#dc2626' : '#9ca3af';
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
        marginBottom: 2,
      }}
    >
      <TextWidget
        text={`${title.toUpperCase()}  ${count}`}
        style={{ color, fontSize: 10, fontWeight: '700' }}
      />
    </FlexWidget>
  );
}

/**
 * One task row: a priority-colored complete checkbox (its own tap target →
 * COMPLETE_TASK) and the title (row tap → open the task).
 */
function TaskRow({ task }: { task: Task }) {
  const priColor = hex(PRIORITY_CONFIG[task.priority as TaskPriority].color);
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: `dodone://task/${task.id}` }}
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 3,
      }}
    >
      <FlexWidget
        clickAction="COMPLETE_TASK"
        clickActionData={{ taskId: task.id }}
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: priColor,
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
  );
}

function InfoRow({ text }: { text: string }) {
  return (
    <TextWidget
      text={text}
      style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}
    />
  );
}

function MoreRow({ count, tabUri }: { count: number; tabUri: string }) {
  return (
    <TextWidget
      text={`+${count} more`}
      clickAction="OPEN_URI"
      clickActionData={{ uri: tabUri }}
      style={{ color: INDIGO, fontSize: 12, fontWeight: '600', marginTop: 4 }}
    />
  );
}

function SignInRow() {
  return (
    <TextWidget
      text="Sign in to DoDone"
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'dodone://' }}
      style={{ color: INDIGO, fontSize: 13, fontWeight: '600', marginTop: 4 }}
    />
  );
}

/**
 * The shared task-list widget both Today and Upcoming render. Given already-built
 * day-groups and the widget height, it fits as many rows as it can and shows a
 * "+N more" affordance for the rest.
 */
export function TaskListWidget({
  title,
  tabUri,
  groups,
  height,
  data,
  emptyText,
}: {
  title: string;
  tabUri: string;
  groups: WidgetGroup[];
  height: number;
  data: WidgetTasks;
  emptyText: string;
}) {
  const children: React.ReactNode[] = [
    <WidgetHeader key="header" title={title} tabUri={tabUri} />,
  ];

  if (data.signedOut) {
    children.push(<SignInRow key="signin" />);
  } else {
    const totalTasks = groups.reduce((n, g) => n + g.tasks.length, 0);
    if (totalTasks === 0) {
      children.push(<InfoRow key="empty" text={emptyText} />);
    } else {
      const { rows, hiddenCount } = flattenGroups(groups, rowCapacity(height));
      for (const row of rows) {
        if (row.type === 'header') {
          children.push(
            <GroupHeader
              key={`h-${row.key}`}
              title={row.title}
              count={row.count}
              overdue={row.overdue}
            />
          );
        } else {
          children.push(<TaskRow key={row.task.id} task={row.task} />);
        }
      }
      if (hiddenCount > 0) {
        children.push(<MoreRow key="more" count={hiddenCount} tabUri={tabUri} />);
      }
    }
  }

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        borderRadius: 16,
        backgroundColor: '#ffffff',
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'column',
      }}
    >
      {children}
    </FlexWidget>
  );
}
