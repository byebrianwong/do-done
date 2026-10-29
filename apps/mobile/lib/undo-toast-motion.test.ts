import { describe, expect, it } from 'vitest';

import {
  TOAST_GAP,
  TOAST_REPLACE_NUDGE,
  riseStart,
  shouldUnmountAfterFade,
  toastBottom,
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

describe('toastBottom', () => {
  it('sits above the safe area off a tab', () => {
    expect(toastBottom(34, null)).toBe(34 + TOAST_GAP);
  });

  it('follows the tab bar as it minimizes', () => {
    const expanded = toastBottom(34, tabRowHeight(0));
    const minimized = toastBottom(34, tabRowHeight(1));
    expect(expanded).toBe(34 + TAB_BAR_ROW_HEIGHT + TOAST_GAP);
    expect(minimized).toBe(34 + TAB_BAR_MINIMIZED_ROW_HEIGHT + TOAST_GAP);
  });
});
