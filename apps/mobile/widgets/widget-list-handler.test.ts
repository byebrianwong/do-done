/**
 * The List widget's half of the task handler: picking a list, re-picking one,
 * and letting go of the pin when the widget is removed.
 *
 * This is the only widget that stores anything, and every way that store can go
 * wrong is silent on a home screen. A pick that is drawn but not written comes
 * back as the picker on the next 30-minute tick. A pin left behind on a removed
 * widget is inherited by the next widget the launcher gives that id to, which
 * opens on a list the user never chose — and reads as the widget being broken
 * rather than as a stale key.
 *
 * Kept apart from `widget-task-handler.test.ts` because that file mocks
 * `@/lib/supabase` into throwing, which is the point of it: it proves the Quick
 * Add tile draws in a cold context where the data layer cannot be constructed.
 * This one needs a data layer that works.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

const state = vi.hoisted(() => ({
  store: new Map<string, string>(),
  projects: [] as unknown[],
  items: [] as unknown[],
  tasks: [] as unknown[],
  completed: [] as string[],
}));

vi.mock('react-native-android-widget', () => ({
  FlexWidget: 'FlexWidget',
  SvgWidget: 'SvgWidget',
  TextWidget: 'TextWidget',
  requestWidgetUpdate: vi.fn(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => state.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      state.store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      state.store.delete(k);
    }),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    },
  },
  getProjectsApi: async () => ({
    list: async () => ({ data: state.projects, error: null }),
  }),
  getTasksApi: async () => ({
    list: async () => ({ data: state.tasks, error: null }),
    listItems: async () => ({ data: state.items, error: null }),
    complete: async (id: string) => {
      state.completed.push(id);
      return { data: null, error: null };
    },
  }),
  getAisleTermsApi: async () => ({
    load: async () => ({ data: new Map(), error: null }),
  }),
}));

const { widgetTaskHandler } = await import('./widget-task-handler');
const { LIST_WIDGET_NAME } = await import('./widget-list-data');
const { targetKey } = await import('./widget-target');
const { SET_LIST_TARGET, CLEAR_LIST_TARGET, COMPLETE_TASK } = await import(
  './widget-actions'
);

function project(id: string, name: string, kind: 'tasks' | 'list') {
  return {
    id,
    user_id: 'u1',
    name,
    kind,
    color: '#22c55e',
    icon: null,
    parent_project_id: null,
    sort_order: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function listProps(
  widgetAction: WidgetTaskHandlerProps['widgetAction'],
  extra: Partial<WidgetTaskHandlerProps> = {},
  widgetId = 7
) {
  const renderWidget = vi.fn();
  const props = {
    widgetInfo: {
      widgetName: LIST_WIDGET_NAME,
      widgetId,
      width: 180,
      height: 150,
    },
    widgetAction,
    renderWidget,
    ...extra,
  } as unknown as WidgetTaskHandlerProps;
  return { props, renderWidget };
}

/** The data the drawn tree was built from — both themes get the same object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawnData(renderWidget: ReturnType<typeof vi.fn>): any {
  const pair = renderWidget.mock.calls[0][0];
  expect(pair.light.props.data).toBe(pair.dark.props.data);
  return pair.light.props.data;
}

beforeEach(() => {
  state.store.clear();
  state.projects = [
    project('groceries', 'Groceries', 'list'),
    project('work', 'Work', 'tasks'),
  ];
  state.items = [];
  state.tasks = [];
  state.completed = [];
  vi.clearAllMocks();
});

describe('picking a list', () => {
  it('asks when nothing is pinned', async () => {
    const { props, renderWidget } = listProps('WIDGET_ADDED');
    await widgetTaskHandler(props);

    const data = drawnData(renderWidget);
    expect(data.state).toBe('pick');
    // Lists lead, because a shopping list is why this widget exists.
    expect(data.candidates.map((p: { id: string }) => p.id)).toEqual([
      'groceries',
      'work',
    ]);
  });

  it('writes the pick before it draws, so the next tick agrees', async () => {
    const { props, renderWidget } = listProps('WIDGET_CLICK', {
      clickAction: SET_LIST_TARGET,
      clickActionData: { projectId: 'groceries' },
    });
    await widgetTaskHandler(props);

    expect(state.store.get(targetKey(7))).toBe('groceries');
    const data = drawnData(renderWidget);
    expect(data.state).toBe('show');
    expect(data.project.id).toBe('groceries');
    expect(data.isList).toBe(true);
  });

  it('keeps the pin across an ordinary update', async () => {
    state.store.set(targetKey(7), 'work');
    const { props, renderWidget } = listProps('WIDGET_UPDATE');
    await widgetTaskHandler(props);

    const data = drawnData(renderWidget);
    expect(data.state).toBe('show');
    expect(data.project.id).toBe('work');
    expect(data.isList).toBe(false);
  });

  it('asks again when the pinned list has been deleted elsewhere', async () => {
    state.store.set(targetKey(7), 'gone');
    const { props, renderWidget } = listProps('WIDGET_UPDATE');
    await widgetTaskHandler(props);

    expect(drawnData(renderWidget).state).toBe('pick');
  });

  it('re-asks on the swap button', async () => {
    state.store.set(targetKey(7), 'groceries');
    const { props, renderWidget } = listProps('WIDGET_CLICK', {
      clickAction: CLEAR_LIST_TARGET,
    });
    await widgetTaskHandler(props);

    expect(state.store.has(targetKey(7))).toBe(false);
    expect(drawnData(renderWidget).state).toBe('pick');
  });

  it('pins two widgets to two different lists', async () => {
    const first = listProps(
      'WIDGET_CLICK',
      { clickAction: SET_LIST_TARGET, clickActionData: { projectId: 'groceries' } },
      7
    );
    const second = listProps(
      'WIDGET_CLICK',
      { clickAction: SET_LIST_TARGET, clickActionData: { projectId: 'work' } },
      8
    );
    await widgetTaskHandler(first.props);
    await widgetTaskHandler(second.props);

    expect(drawnData(first.renderWidget).project.id).toBe('groceries');
    expect(drawnData(second.renderWidget).project.id).toBe('work');
  });
});

describe('removing the widget', () => {
  it('lets go of the pin, because the launcher reuses widget ids', async () => {
    state.store.set(targetKey(7), 'groceries');
    const { props, renderWidget } = listProps('WIDGET_DELETED');
    await widgetTaskHandler(props);

    expect(state.store.has(targetKey(7))).toBe(false);
    expect(renderWidget).not.toHaveBeenCalled();
  });

  it('leaves another widget id alone', async () => {
    state.store.set(targetKey(7), 'groceries');
    state.store.set(targetKey(8), 'work');
    await widgetTaskHandler(listProps('WIDGET_DELETED', {}, 7).props);

    expect(state.store.get(targetKey(8))).toBe('work');
  });
});

describe('ticking a row off', () => {
  it('writes, then redraws from what the write produced', async () => {
    state.store.set(targetKey(7), 'groceries');
    const { props, renderWidget } = listProps('WIDGET_CLICK', {
      clickAction: COMPLETE_TASK,
      clickActionData: { taskId: 'item-1' },
    });
    await widgetTaskHandler(props);

    expect(state.completed).toEqual(['item-1']);
    expect(renderWidget).toHaveBeenCalledOnce();
  });

  it('keeps the task widgets in step, since the task left Today too', async () => {
    const { requestWidgetUpdate } = await import('react-native-android-widget');
    state.store.set(targetKey(7), 'work');
    await widgetTaskHandler(
      listProps('WIDGET_CLICK', {
        clickAction: COMPLETE_TASK,
        clickActionData: { taskId: 'task-1' },
      }).props
    );

    const names = vi
      .mocked(requestWidgetUpdate)
      .mock.calls.map(([args]) => args.widgetName);
    expect(names).toEqual(
      expect.arrayContaining(['Today', 'Upcoming', 'NextUp'])
    );
  });

  it('does not sweep the task widgets when nothing was written', async () => {
    const { requestWidgetUpdate } = await import('react-native-android-widget');
    state.store.set(targetKey(7), 'groceries');
    await widgetTaskHandler(
      listProps('WIDGET_CLICK', {
        clickAction: COMPLETE_TASK,
        // The launcher handing back a payload with no id is the shape a
        // mis-wired click has, and a sweep on it would be pure work.
        clickActionData: {},
      }).props
    );

    expect(requestWidgetUpdate).not.toHaveBeenCalled();
  });
});
