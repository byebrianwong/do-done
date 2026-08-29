import { describe, expect, it } from 'vitest';

import {
  EXPAND_AT_TOP_PX,
  EXPAND_TRAVEL_PX,
  MINIMIZE_AT_REST,
  MINIMIZE_TRAVEL_PX,
  TAB_BAR_MINIMIZED_ROW_HEIGHT,
  TAB_BAR_ROW_HEIGHT,
  TAB_ICON_MINIMIZED_SCALE,
  TAB_ICON_SIZE,
  TAB_LABEL_FADE_END,
  clampToScrollRange,
  maxScrollOffset,
  nextMinimizeState,
  tabBarHeight,
  tabIconScale,
  tabLabelOpacity,
  tabRowHeight,
  type MinimizeState,
} from './tab-bar-motion';

/** Feed a run of offsets through the policy, the way a scroll would. */
function scroll(
  from: MinimizeState,
  offsets: number[],
  canMinimize = true
): MinimizeState {
  return offsets.reduce((s, y) => nextMinimizeState(s, y, canMinimize), from);
}

describe('nextMinimizeState', () => {
  it('starts expanded and stays expanded at the top of the list', () => {
    const s = scroll(MINIMIZE_AT_REST, [0, 2, 5, EXPAND_AT_TOP_PX]);
    expect(s.minimized).toBe(false);
  });

  it('minimizes once the scroll has travelled far enough down', () => {
    expect(scroll(MINIMIZE_AT_REST, [MINIMIZE_TRAVEL_PX]).minimized).toBe(true);
  });

  it('does not minimize on travel short of the threshold', () => {
    expect(scroll(MINIMIZE_AT_REST, [MINIMIZE_TRAVEL_PX - 1]).minimized).toBe(
      false
    );
  });

  it('expands again on an upward scroll', () => {
    const down = scroll(MINIMIZE_AT_REST, [200, 200 + MINIMIZE_TRAVEL_PX]);
    expect(down.minimized).toBe(true);
    expect(scroll(down, [down.anchor - EXPAND_TRAVEL_PX]).minimized).toBe(false);
  });

  it('expands more readily than it minimizes', () => {
    // The asymmetry is deliberate: a bar that will not come back is the user
    // pulling at their own navigation and getting nothing back, which is a far worse
    // failure than one that minimized a little eagerly. Same travel, opposite
    // directions, different verdicts.
    const travel = EXPAND_TRAVEL_PX;
    expect(travel).toBeLessThan(MINIMIZE_TRAVEL_PX);

    // Down by `travel` from the top: not enough, bar stays.
    expect(scroll(MINIMIZE_AT_REST, [travel]).minimized).toBe(false);

    // Up by the same `travel` from minimized: enough, bar returns.
    const minimized = scroll(MINIMIZE_AT_REST, [300, 300 + MINIMIZE_TRAVEL_PX]);
    expect(scroll(minimized, [minimized.anchor - travel]).minimized).toBe(false);
  });

  it('always expands near the top, however it got there', () => {
    const minimized = scroll(MINIMIZE_AT_REST, [400, 400 + MINIMIZE_TRAVEL_PX]);
    expect(minimized.minimized).toBe(true);
    // Jumping to the top — a status-bar tap, a list that shrank under a filter
    // — is not a scroll *run*, so it must not have to clear a travel threshold.
    expect(nextMinimizeState(minimized, 0, true).minimized).toBe(false);
  });

  it('measures a reversal from the turning point, not from one frame ago', () => {
    // If the anchor tracked the last offset in both directions, accumulated
    // travel would reset every frame and the bar could never come back at all.
    let s = scroll(MINIMIZE_AT_REST, [50, 100, 150, 200, 250, 300]);
    expect(s.minimized).toBe(true);
    for (let y = 300; y > 300 - EXPAND_TRAVEL_PX; y -= 2) {
      s = nextMinimizeState(s, y, true);
    }
    expect(s.minimized).toBe(true);
    expect(nextMinimizeState(s, 300 - EXPAND_TRAVEL_PX, true).minimized).toBe(
      false
    );
  });

  it('does not read the rubber band at the top as upward travel', () => {
    // An iOS list bounces past 0 at the end of a flick. Taken as a real
    // negative offset that bounce is a large upward delta, so every flick
    // would end by re-expanding the bar.
    const minimized = scroll(MINIMIZE_AT_REST, [500, 500 + MINIMIZE_TRAVEL_PX]);
    expect(nextMinimizeState(minimized, -40, true)).toEqual({
      minimized: false,
      anchor: 0,
    });
  });

  it('ignores a frame that did not move', () => {
    const s = scroll(MINIMIZE_AT_REST, [100]);
    expect(nextMinimizeState(s, 100, true)).toBe(s);
  });

  it('returns the same object while travel is still accumulating', () => {
    // Identity is the caller's signal that nothing flipped, which is what
    // keeps a scroll frame from touching the shared value.
    const s = scroll(MINIMIZE_AT_REST, [EXPAND_AT_TOP_PX + 2]);
    expect(s).toBe(MINIMIZE_AT_REST);
    expect(nextMinimizeState(s, EXPAND_AT_TOP_PX + 4, true)).toBe(s);
  });
});

describe('nextMinimizeState / canMinimize', () => {
  it('cannot minimize while vetoed, however far the list scrolls', () => {
    expect(scroll(MINIMIZE_AT_REST, [100, 300, 600, 900], false).minimized).toBe(
      false
    );
  });

  it('vetoes minimizing only — a minimized bar can still come back', () => {
    // Its callers are things that can get stuck: a drag whose end never fires,
    // a Reduce Motion flag read asynchronously at launch. A stuck veto must
    // leave the bar expanded, never trap it minimized.
    const minimized = scroll(MINIMIZE_AT_REST, [300, 300 + MINIMIZE_TRAVEL_PX]);
    expect(minimized.minimized).toBe(true);
    expect(
      nextMinimizeState(minimized, minimized.anchor - EXPAND_TRAVEL_PX, false)
        .minimized
    ).toBe(false);
  });

  it('re-measures from the current position when the veto lifts', () => {
    // Travel accumulated while frozen must not fire the instant it unfreezes —
    // otherwise dropping a dragged row would minimize the bar under the finger.
    const frozen = scroll(MINIMIZE_AT_REST, [100, 400], false);
    expect(nextMinimizeState(frozen, 401, true).minimized).toBe(false);
  });
});

describe('the rubber band at either end', () => {
  it('reports over-scroll past the top as the top', () => {
    expect(clampToScrollRange(-40, 500)).toBe(0);
  });

  it('reports over-scroll past the bottom as the bottom', () => {
    expect(clampToScrollRange(514, 500)).toBe(500);
  });

  it('leaves an ordinary offset alone', () => {
    expect(clampToScrollRange(250, 500)).toBe(250);
  });

  it('does not clamp at the far end while the range is unknown', () => {
    expect(clampToScrollRange(9000, null)).toBe(9000);
    // The near end never needs a measurement.
    expect(clampToScrollRange(-40, null)).toBe(0);
  });

  it('holds the bar through the settle at the end of a flick', () => {
    // Flick to the end of a list and it overshoots by ten or fifteen points,
    // then eases back. That easing is a clean run of decreasing offsets right
    // around EXPAND_TRAVEL_PX, so without the clamp it re-expanded the bar
    // about half the times you reached the bottom of a list.
    const max = 760;
    let s = scroll(MINIMIZE_AT_REST, [200, 500, max], true);
    expect(s.minimized).toBe(true);
    for (const y of [772, 770, 767, 763, 760, 758, 757, 756]) {
      s = nextMinimizeState(s, y, true, max);
    }
    expect(s.minimized).toBe(true);
  });

  it('still expands on a real scroll away from the bottom', () => {
    const max = 760;
    let s = scroll(MINIMIZE_AT_REST, [200, 500, max], true);
    expect(s.minimized).toBe(true);
    s = nextMinimizeState(s, max - EXPAND_TRAVEL_PX, true, max);
    expect(s.minimized).toBe(false);
  });

  it('does not turn an over-scroll drag past the end into travel', () => {
    // Dragging past the bottom keeps reporting larger offsets, which unclamped
    // is indistinguishable from more list to scroll. A list with only 20pt of
    // range has less than the threshold and must never minimize, however far
    // past its end the finger drags it.
    const range = MINIMIZE_TRAVEL_PX - 4;
    expect(
      nextMinimizeState(MINIMIZE_AT_REST, 200, true, range).minimized
    ).toBe(false);
    // Same offset with no measurement yet: the clamp is what made the
    // difference, not some other rule.
    expect(nextMinimizeState(MINIMIZE_AT_REST, 200, true, null).minimized).toBe(
      true
    );
  });
});

describe('maxScrollOffset', () => {
  it('is the content that does not fit', () => {
    expect(maxScrollOffset(1600, 874)).toBe(726);
  });

  it('is zero for content that fits, not a negative range', () => {
    expect(maxScrollOffset(400, 874)).toBe(0);
  });

  it('is null until both measurements have arrived', () => {
    // A list reports its content size a frame or two after it lays out, and
    // refusing to react until then would eat the start of the first scroll.
    expect(maxScrollOffset(null, 874)).toBeNull();
    expect(maxScrollOffset(1600, null)).toBeNull();
  });
});

describe('interpolation', () => {
  it('runs between the two row heights', () => {
    expect(tabRowHeight(0)).toBe(TAB_BAR_ROW_HEIGHT);
    expect(tabRowHeight(1)).toBe(TAB_BAR_MINIMIZED_ROW_HEIGHT);
    expect(tabRowHeight(0.5)).toBeCloseTo(
      (TAB_BAR_ROW_HEIGHT + TAB_BAR_MINIMIZED_ROW_HEIGHT) / 2
    );
  });

  it('clamps outside 0..1, so a spring overshoot cannot invert the bar', () => {
    expect(tabRowHeight(-0.4)).toBe(TAB_BAR_ROW_HEIGHT);
    expect(tabRowHeight(1.4)).toBe(TAB_BAR_MINIMIZED_ROW_HEIGHT);
    expect(tabIconScale(1.4)).toBe(TAB_ICON_MINIMIZED_SCALE);
    expect(tabLabelOpacity(-1)).toBe(1);
  });

  it('never interpolates the safe-area inset', () => {
    const inset = 34;
    expect(tabBarHeight(0, inset)).toBe(inset + TAB_BAR_ROW_HEIGHT);
    expect(tabBarHeight(1, inset)).toBe(inset + TAB_BAR_MINIMIZED_ROW_HEIGHT);
  });

  it('finishes fading the labels before the row can clip them', () => {
    expect(tabLabelOpacity(TAB_LABEL_FADE_END)).toBe(0);
    expect(TAB_LABEL_FADE_END).toBeLessThan(1);
    // Still visible at the start of the sweep, or the labels would blink out.
    expect(tabLabelOpacity(0.1)).toBeGreaterThan(0);
  });

  it('shrinks the icon without hiding it', () => {
    expect(tabIconScale(0)).toBe(1);
    expect(tabIconScale(1)).toBe(TAB_ICON_MINIMIZED_SCALE);
    expect(TAB_ICON_MINIMIZED_SCALE).toBeGreaterThan(0.5);
  });

  it('leaves a minimized row tall enough for the icon it holds', () => {
    // The row clips its content, so an icon taller than the minimized row
    // would come out the other side of this with its feet cut off.
    expect(TAB_ICON_SIZE * TAB_ICON_MINIMIZED_SCALE).toBeLessThan(
      TAB_BAR_MINIMIZED_ROW_HEIGHT
    );
  });
});
