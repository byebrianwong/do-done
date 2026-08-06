/**
 * What the launcher does with the Quick Add tile, tested where a device can't
 * help.
 *
 * The tile has exactly one failure mode and it is silent: nothing draws, so the
 * home screen shows an invisible 1x1 hole. No crash, no log the user will ever
 * see, and `updatePeriodMillis: 0` means there is no second attempt. It has
 * happened twice — once when `IconWidget` drew the word "add" in a font the app
 * doesn't ship, and once when the handler was registered from a route module
 * that a headless JS context never evaluates.
 *
 * So these tests pin the three properties that keep something on the screen: the
 * handler draws for every action that isn't a delete, the tile carries its own
 * painted background rather than trusting AndroidSVG alone, and the whole path
 * runs with the data layer unavailable — which is what a headless widget update
 * looks like when the app has never been opened.
 */
import { describe, it, expect, vi } from 'vitest';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

// The library reaches through `react-native` for a native module that doesn't
// exist here. Its widgets only need to be identifiable in the returned tree.
vi.mock('react-native-android-widget', () => ({
  FlexWidget: 'FlexWidget',
  SvgWidget: 'SvgWidget',
  requestWidgetUpdate: vi.fn(),
}));

// The data layer as a cold headless context can find it: unconstructable. If
// drawing the tile depends on this module in any way, these tests stop passing.
vi.mock('@/lib/supabase', () => {
  throw new Error('supabase is unavailable in a headless widget context');
});

const { widgetTaskHandler } = await import('./widget-task-handler');

type WidgetAction = WidgetTaskHandlerProps['widgetAction'];

/** Props as the native side hands them over, plus a spy for what got drawn. */
function quickAddProps(
  widgetAction: WidgetAction,
  size: { width: number; height: number } = { width: 57, height: 102 }
) {
  const renderWidget = vi.fn();
  const props = {
    widgetInfo: {
      widgetName: 'QuickAdd',
      widgetId: 1,
      ...size,
    },
    widgetAction,
    renderWidget,
  } as unknown as WidgetTaskHandlerProps;
  return { props, renderWidget };
}

/** Call the element's component to get the widget tree it describes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(element: any) {
  return element.type(element.props);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function childrenOf(node: any): any[] {
  const kids = node?.props?.children;
  if (!kids) return [];
  return Array.isArray(kids) ? kids : [kids];
}

describe('the Quick Add tile', () => {
  const DRAWING_ACTIONS: WidgetAction[] = [
    'WIDGET_ADDED',
    'WIDGET_UPDATE',
    'WIDGET_RESIZED',
    'WIDGET_CLICK',
  ];

  it.each(DRAWING_ACTIONS)('draws on %s', async (action) => {
    const { props, renderWidget } = quickAddProps(action);
    await widgetTaskHandler(props);
    expect(renderWidget).toHaveBeenCalledOnce();
  });

  it('draws nothing on WIDGET_DELETED', async () => {
    const { props, renderWidget } = quickAddProps('WIDGET_DELETED');
    await widgetTaskHandler(props);
    expect(renderWidget).not.toHaveBeenCalled();
  });

  it('paints its own background, so a failed SVG parse still leaves a tile', async () => {
    const { props, renderWidget } = quickAddProps('WIDGET_ADDED');
    await widgetTaskHandler(props);

    const tile = childrenOf(render(renderWidget.mock.calls[0][0]))[0];
    expect(tile.props.style.backgroundColor).toBe('#6366f1');
    expect(tile.props.style.borderRadius).toBeGreaterThan(0);

    const svg = childrenOf(tile)[0];
    expect(svg.type).toBe('SvgWidget');
    expect(svg.props.svg).toContain('<svg');
  });

  it('draws a square on the shorter side of the cell', async () => {
    const { props, renderWidget } = quickAddProps('WIDGET_ADDED', {
      width: 57,
      height: 102,
    });
    await widgetTaskHandler(props);

    const tile = childrenOf(render(renderWidget.mock.calls[0][0]))[0];
    expect(tile.props.style.width).toBe(57);
    expect(tile.props.style.height).toBe(57);
  });

  it('falls back to a fixed size when the launcher reports none', async () => {
    const { props, renderWidget } = quickAddProps('WIDGET_ADDED', {
      width: 0,
      height: 0,
    });
    await widgetTaskHandler(props);

    const tile = childrenOf(render(renderWidget.mock.calls[0][0]))[0];
    expect(tile.props.style.width).toBeGreaterThan(0);
    expect(tile.props.style.height).toBe(tile.props.style.width);
  });

  it('opens the quick-add activity by its own scheme', async () => {
    const { props, renderWidget } = quickAddProps('WIDGET_ADDED');
    await widgetTaskHandler(props);

    const root = render(renderWidget.mock.calls[0][0]);
    expect(root.props.clickAction).toBe('OPEN_URI');
    // `dodoneadd`, not `dodone`: the app's own scheme would raise a chooser and
    // launch MainActivity instead of the translucent composer.
    expect(root.props.clickActionData.uri).toBe('dodoneadd://open');
  });

  it('draws without the data layer being loadable at all', async () => {
    // Proves the mock above is doing something: the task-list widgets' module
    // genuinely cannot be imported in this context...
    await expect(import('./widget-data')).rejects.toThrow();

    // ...and the tile is drawn anyway, because nothing on its path imports it.
    const { props, renderWidget } = quickAddProps('WIDGET_ADDED');
    await widgetTaskHandler(props);
    expect(renderWidget).toHaveBeenCalledOnce();
  });
});

describe('widgets the handler does not know', () => {
  it('are ignored rather than drawn wrong', async () => {
    const renderWidget = vi.fn();
    await widgetTaskHandler({
      widgetInfo: { widgetName: 'Nope', widgetId: 2, width: 100, height: 100 },
      widgetAction: 'WIDGET_ADDED',
      renderWidget,
    } as unknown as WidgetTaskHandlerProps);
    expect(renderWidget).not.toHaveBeenCalled();
  });
});
