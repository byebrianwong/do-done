/**
 * The list widgets scroll, and the library's own tree builder accepts them.
 *
 * `ListWidget` draws each direct child to its own image, and that puts rules on
 * what a child may be. None of them fail at build time or in a type-check. A
 * margin on an item's root is dropped from its image but still offsets its tap
 * areas, so the ring completes the wrong row or nothing at all. A third
 * `ListWidget`, or one inside another, throws when the tree is built, and the
 * widget is left blank. So does a component that returns null. So these tests
 * build the real tree, with the library's real widget components, and check it.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { Project, Task } from '@do-done/shared';
import { todayLocalISO } from '@do-done/shared';

// `SvgWidget` reaches for `Image.resolveAssetSource`, which is only used for a
// `require()`d asset. Every SVG here is a string.
vi.mock('react-native', () => ({ Image: { resolveAssetSource: () => null } }));

// The real components, not stand-ins: their `convertProps` is what the native
// side receives, and that is what these tests are about.
vi.mock('react-native-android-widget', async () => {
  const [flex, text, svg, list] = await Promise.all([
    import('react-native-android-widget/src/widgets/FlexWidget'),
    import('react-native-android-widget/src/widgets/TextWidget'),
    import('react-native-android-widget/src/widgets/SvgWidget'),
    import('react-native-android-widget/src/widgets/ListWidget'),
  ]);
  return {
    FlexWidget: flex.FlexWidget,
    TextWidget: text.TextWidget,
    SvgWidget: svg.SvgWidget,
    ListWidget: list.ListWidget,
  };
});

const { buildWidgetTree } = await import(
  'react-native-android-widget/src/api/build-widget-tree'
);
const { TodayWidget } = await import('./TodayWidget');
const { UpcomingWidget } = await import('./UpcomingWidget');
const { ListWidget } = await import('./ListWidget');
const { LIGHT_THEME } = await import('./widget-theme');
const { WIDGET_MAX_LIST_ROWS } = await import('./widget-layout');

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: Node[];
}

let seq = 0;

function task(overrides: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `task-${seq}`,
    user_id: 'user-1',
    title: `Task ${seq}`,
    description: null,
    status: 'not_started',
    priority: 'p3',
    project_id: null,
    parent_task_id: null,
    scheduled_date: todayLocalISO(),
    scheduled_time: null,
    deadline_date: null,
    deadline_time: null,
    duration_minutes: null,
    energy_level: null,
    recurrence_rule: null,
    completed_at: null,
    focus_override: null,
    sort_order: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Task;
}

function project(id: string, name: string): Project {
  return {
    id,
    user_id: 'user-1',
    name,
    color: '#22c55e',
    icon: null,
    parent_project_id: null,
    sort_order: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  } as Project;
}

function lists(node: Node): Node[] {
  const own = node.type === 'ListWidget' ? [node] : [];
  return [...own, ...(node.children ?? []).flatMap(lists)];
}

/** Today at its smallest allowed height, where the old layout showed one row. */
function todayTree(tasks: Task[]): Node {
  return buildWidgetTree(
    React.createElement(TodayWidget, {
      data: { signedOut: false, tasks, projects: [] },
      width: 250,
      height: 110,
      theme: LIGHT_THEME,
    })
  ) as Node;
}

describe('the task widgets scroll', () => {
  it('put every row in one list, under a header that does not scroll', () => {
    const tree = todayTree(Array.from({ length: 12 }, () => task()));
    const found = lists(tree);
    expect(found).toHaveLength(1);
    // Twelve tasks on a cell with room for about two. All twelve are items.
    expect(found[0].children).toHaveLength(12);
    // The list is the card's last child: the header bar sits above it, outside.
    const card = tree;
    expect(card.children?.[card.children.length - 1]).toBe(found[0]);
  });

  it('give every item a full-width root with no margin', () => {
    const overdue = task({ scheduled_date: '2020-01-01', priority: 'p1' });
    const today = Array.from({ length: WIDGET_MAX_LIST_ROWS + 3 }, () => task());
    // Two groups, so there are headers, and past the cap, so there is "+N more".
    const [list] = lists(todayTree([overdue, ...today]));
    const items = list.children ?? [];
    expect(items.length).toBeGreaterThan(WIDGET_MAX_LIST_ROWS);

    for (const item of items) {
      expect(item.type).toBe('LinearLayoutWidget');
      expect(item.props.width).toBe('match_parent');
      for (const key of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight']) {
        expect(item.props[key] ?? 0).toBe(0);
      }
    }
  });

  it('keep the ring a tap of its own inside the row', () => {
    const t = task();
    const [list] = lists(todayTree([t]));
    const row = list.children?.[0];
    expect(row?.props.clickAction).toBe('OPEN_URI');

    const nested: Node[] = [];
    const walk = (n: Node) => {
      if (n !== row && n.props.clickAction) nested.push(n);
      (n.children ?? []).forEach(walk);
    };
    walk(row as Node);
    expect(nested.map((n) => n.props.clickAction)).toEqual(['COMPLETE_TASK']);
  });

  it('build a valid tree for Upcoming too', () => {
    const tree = buildWidgetTree(
      React.createElement(UpcomingWidget, {
        data: {
          signedOut: false,
          tasks: [task(), task({ scheduled_date: null })],
          projects: [],
        },
        width: 250,
        height: 150,
        theme: LIGHT_THEME,
      })
    ) as Node;
    expect(lists(tree)).toHaveLength(1);
  });

  it('draw no list when there is nothing to list', () => {
    expect(lists(todayTree([]))).toHaveLength(0);
  });
});

describe('a ring with nothing to draw', () => {
  it('still builds, for an icon this build cannot draw', () => {
    // `WidgetProjectIcon` used to return null here, and the tree builder threw
    // on it. The row guards on the stored value, which is set, so only the
    // parse knew there was nothing to draw.
    const p = { ...project('p1', 'Home'), icon: 'ph:not-in-this-build:fill' };
    const tree = buildWidgetTree(
      React.createElement(TodayWidget, {
        data: { signedOut: false, tasks: [task({ project_id: 'p1' })], projects: [p] },
        width: 250,
        height: 110,
        theme: LIGHT_THEME,
      })
    ) as Node;
    expect(lists(tree)[0].children).toHaveLength(1);
  });
});

describe('the List widget picker scrolls', () => {
  it('offers every candidate, however short the cell', () => {
    const candidates = Array.from({ length: 9 }, (_, i) =>
      project(`p${i}`, `Project ${i}`)
    );
    const tree = buildWidgetTree(
      React.createElement(ListWidget, {
        data: { state: 'pick', candidates },
        width: 250,
        height: 110,
        theme: LIGHT_THEME,
      })
    ) as Node;
    const [list] = lists(tree);
    expect(list.children).toHaveLength(9);
    expect(list.children?.every((c) => c.props.clickAction === 'SET_LIST_TARGET')).toBe(
      true
    );
  });
});
