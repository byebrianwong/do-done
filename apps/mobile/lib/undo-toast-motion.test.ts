import { describe, expect, it } from 'vitest';

import {
  TOAST_GAP,
  TOAST_REPLACE_NUDGE,
  riseStart,
  shouldUnmountAfterFade,
  tabsShowing,
  toastBottom,
  toastLift,
  toastShowMode,
} from './undo-toast-motion';
import { TAB_BAR_MINIMIZED_ROW_HEIGHT, TAB_BAR_ROW_HEIGHT, tabRowHeight } from './tab-bar-motion';

describe('toastShowMode', () => {
  it('enters when nothing is mounted', () => {
    expect(toastShowMode(false, false)).toBe('enter');
  });

  it('replaces in place when a toast is already up', () => {
    expect(toastShowMode(true, false)).toBe('replace');
  });

  it('lands on the end state under Reduce Motion', () => {
    expect(toastShowMode(false, true)).toBe('instant');
    expect(toastShowMode(true, true)).toBe('instant');
  });
});

describe('riseStart', () => {
  it('rises the full distance on enter, a little on replace, not at all when instant', () => {
    expect(riseStart('enter')).toBe(1);
    expect(riseStart('replace')).toBe(TOAST_REPLACE_NUDGE);
    expect(riseStart('instant')).toBe(0);
  });

  it('a replacement dips less than an entrance', () => {
    expect(riseStart('replace')).toBeGreaterThan(0);
    expect(riseStart('replace')).toBeLessThan(riseStart('enter'));
  });
});

describe('shouldUnmountAfterFade', () => {
  it('unmounts the toast that finished fading', () => {
    expect(shouldUnmountAfterFade(true, 3, 3)).toBe(true);
  });

  it('keeps a toast whose fade was interrupted by a new show()', () => {
    expect(shouldUnmountAfterFade(false, 3, 3)).toBe(false);
  });

  it('keeps a newer toast that arrived before the callback ran', () => {
    expect(shouldUnmountAfterFade(true, 3, 4)).toBe(false);
  });

  it('does nothing once the toast is already gone', () => {
    expect(shouldUnmountAfterFade(true, 3, null)).toBe(false);
  });

  it('treats a missing finished flag as interrupted', () => {
    expect(shouldUnmountAfterFade(undefined, 3, 3)).toBe(false);
  });
});

describe('toast placement', () => {
  const at = (inset: number, onTab: number, progress: number) =>
    toastBottom(inset) + toastLift(onTab, tabRowHeight(progress));

  it('sits above the safe area off a tab', () => {
    expect(at(34, 0, 0)).toBe(34 + TOAST_GAP);
    // The bar's progress means nothing off a tab.
    expect(at(34, 0, 1)).toBe(34 + TOAST_GAP);
  });

  it('stays level with the add button as the bar minimizes', () => {
    // The add button's bottom: inset + row height + 16, as in QuickAddButton.
    for (const p of [0, 0.5, 1]) {
      expect(at(34, 1, p)).toBe(34 + tabRowHeight(p) + TOAST_GAP);
    }
    expect(at(34, 1, 0)).toBe(34 + TAB_BAR_ROW_HEIGHT + TOAST_GAP);
    expect(at(34, 1, 1)).toBe(34 + TAB_BAR_MINIMIZED_ROW_HEIGHT + TOAST_GAP);
  });

  it('slides between the two rather than jumping', () => {
    const mid = at(34, 0.5, 0);
    expect(mid).toBeGreaterThan(at(34, 0, 0));
    expect(mid).toBeLessThan(at(34, 1, 0));
  });
});

describe('tabsShowing', () => {
  it('is true on the tabs and under the modals drawn over them', () => {
    expect(tabsShowing('(tabs)')).toBe(true);
    expect(tabsShowing('quick-add')).toBe(true);
    expect(tabsShowing('task/[id]')).toBe(true);
  });

  it('is false on a screen that covers the tabs', () => {
    expect(tabsShowing('settings')).toBe(false);
    expect(tabsShowing('completed')).toBe(false);
    expect(tabsShowing(undefined)).toBe(false);
  });
});
