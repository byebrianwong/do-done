/**
 * The two colour tables the home-screen widgets draw with.
 *
 * `react-native-android-widget` accepts `renderWidget({ light, dark })` and
 * lets the launcher pick, so a widget gets a real dark variant for the cost of
 * rendering the same tree twice with a different table. We were handing it one
 * hard white card, which is why the widget glared on a dark home screen.
 *
 * Nothing forks except the colours. There is one component tree, and a theme is
 * an argument to it.
 */

import { OVERDUE_COLOR, PRIORITY_CONFIG } from '@do-done/shared';
import type { Project } from '@do-done/shared';

export interface WidgetTheme {
  /** Which table this is — for tests, and for the odd asymmetric decision. */
  scheme: 'light' | 'dark';
  /** The card itself. Never pure black: an AMOLED wallpaper would swallow it. */
  card: string;
  title: string;
  /** An overdue title, which is heavier as well as darker. */
  titleStrong: string;
  titleDone: string;
  subline: string;
  groupLabel: string;
  /** The overdue group label and the overdue gutter dot. */
  overdue: string;
  p1: string;
  p2: string;
  /**
   * The lowest rank that draws. Cool, so it reads as ranked rather than urgent
   * beside p1/p2 — and lifted on the dark card, where slate would sink into it.
   */
  p3: string;
  /** "+N more" and the signed-out prompt. */
  accent: string;
  plusBackground: string;
  plusGlyph: string;
  /** The ring for a task with no project: chosen, not a missing value. */
  noProjectRing: string;
}

export const LIGHT_THEME: WidgetTheme = {
  scheme: 'light',
  card: '#ffffff',
  title: '#1f2937',
  titleStrong: '#111827',
  titleDone: '#9ca3af',
  subline: '#9ca3af',
  groupLabel: '#9ca3af',
  overdue: OVERDUE_COLOR,
  p1: PRIORITY_CONFIG.p1.color,
  p2: PRIORITY_CONFIG.p2.color,
  p3: PRIORITY_CONFIG.p3.color,
  accent: '#5b5ee0',
  plusBackground: '#eef2ff',
  plusGlyph: '#6366f1',
  noProjectRing: '#94a3b8',
};

export const DARK_THEME: WidgetTheme = {
  scheme: 'dark',
  card: '#191b22',
  title: '#e6e8ee',
  titleStrong: '#f4f5f9',
  titleDone: '#6d7381',
  subline: '#7c8291',
  groupLabel: '#757b8a',
  // The one place a priority colour is not the shared value: these are the
  // light ramp lifted toward white, the same treatment a project's colour gets
  // below, because the dark card would otherwise swallow them. Same hues, same
  // order — a lift, not a second opinion.
  overdue: '#f87171',
  p1: '#f87171',
  p2: '#fb923c',
  p3: '#94a3b8',
  accent: '#9093f7',
  plusBackground: '#2c2f52',
  plusGlyph: '#a5b4fc',
  noProjectRing: '#7c8493',
};

/**
 * How far a project's colour is lifted toward white on the dark card. Enough to
 * clear a #191b22 ground; small enough that the colour is still the one the
 * user picked.
 */
const DARK_LIFT = 0.28;

/**
 * A project's ring colour for a theme.
 *
 * The hue is **never** replaced. A user who picked green for Home has to find
 * green on both cards, so the dark table mixes the same colour toward white
 * rather than substituting a palette value. An unparseable colour falls back to
 * the neutral ring instead of drawing nothing.
 */
export function ringColor(
  project: Pick<Project, 'color'> | null | undefined,
  theme: WidgetTheme
): string {
  const rgb = project ? parseHex(project.color) : null;
  if (!rgb) return theme.noProjectRing;
  if (theme.scheme === 'light') return toHex(rgb);
  return toHex(rgb.map((c) => c + (255 - c) * DARK_LIFT) as Rgb);
}

type Rgb = [number, number, number];

function parseHex(value: string): Rgb | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0'))
      .join('')
  );
}
