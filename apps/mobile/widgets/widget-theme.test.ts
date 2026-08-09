/**
 * The dark card's one rule: a project's colour is lifted, never replaced.
 *
 * A user who picked green for Home has to find green on both cards. Swapping in
 * a palette value would be invisible in code review and obvious — and wrong —
 * on a home screen.
 */
import { describe, it, expect } from 'vitest';
import { DARK_THEME, LIGHT_THEME, ringColor } from './widget-theme';

/** Which channel is largest — the coarse "is this still green" test. */
function dominantChannel(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  return rgb.indexOf(Math.max(...rgb));
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
}

describe('the ring colour', () => {
  it('is the project colour untouched on the light card', () => {
    expect(ringColor({ color: '#22c55e' }, LIGHT_THEME)).toBe('#22c55e');
  });

  it('lifts toward white on the dark card without changing the hue', () => {
    const lifted = ringColor({ color: '#22c55e' }, DARK_THEME);
    expect(lifted).not.toBe('#22c55e');
    expect(luminance(lifted)).toBeGreaterThan(luminance('#22c55e'));
    expect(dominantChannel(lifted)).toBe(dominantChannel('#22c55e'));
  });

  it('keeps every palette colour distinguishable after the lift', () => {
    const palette = ['#22c55e', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9'];
    const lifted = palette.map((c) => ringColor({ color: c }, DARK_THEME));
    expect(new Set(lifted).size).toBe(palette.length);
  });

  it('falls back to the neutral ring for no project', () => {
    expect(ringColor(null, LIGHT_THEME)).toBe(LIGHT_THEME.noProjectRing);
    expect(ringColor(undefined, DARK_THEME)).toBe(DARK_THEME.noProjectRing);
  });

  it('falls back rather than drawing nothing for an unparseable colour', () => {
    expect(ringColor({ color: 'rebeccapurple' }, LIGHT_THEME)).toBe(
      LIGHT_THEME.noProjectRing
    );
    expect(ringColor({ color: '#abc' }, DARK_THEME)).toBe(DARK_THEME.noProjectRing);
  });

  it('always returns a 6-digit hex, which is all the widget layer accepts', () => {
    for (const theme of [LIGHT_THEME, DARK_THEME]) {
      expect(ringColor({ color: '#ffffff' }, theme)).toMatch(/^#[0-9a-f]{6}$/);
      expect(ringColor({ color: '#000000' }, theme)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('the two colour tables', () => {
  it('never paints the card pure black, which an AMOLED wallpaper swallows', () => {
    expect(DARK_THEME.card).not.toBe('#000000');
    expect(luminance(DARK_THEME.card)).toBeGreaterThan(0);
  });

  it('describes the same set of slots, so one tree can draw either', () => {
    expect(Object.keys(LIGHT_THEME).sort()).toEqual(Object.keys(DARK_THEME).sort());
  });

  it('puts the text on the right side of its own card', () => {
    expect(luminance(LIGHT_THEME.title)).toBeLessThan(luminance(LIGHT_THEME.card));
    expect(luminance(DARK_THEME.title)).toBeGreaterThan(luminance(DARK_THEME.card));
  });
});
