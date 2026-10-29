/**
 * How the two swap tabs move when they change view.
 *
 * Today ⟷ Upcoming and All ⟷ Inbox used to swap one whole tree for another on
 * a ternary, so every pixel of the screen changed in one frame. Now the old
 * view fades out while the new one fades in, and the swap glyph in the title
 * turns over.
 *
 * Pure, so the node suite covers it. `components/SwapView.tsx` and
 * `components/SwapTitle.tsx` draw it.
 */
import type { ModeChangeCause } from './view-mode';

/** One full crossfade. Short: a swap is a toggle, not a journey. */
export const SWAP_FADE_MS = 180;

/**
 * How long the swap glyph takes to turn over. A little longer than the fade,
 * because a 17px glyph turning in 180ms reads as a jump rather than a turn.
 */
export const SWAP_GLYPH_MS = 260;

export type SwapTab = 'agenda' | 'tasks';

export interface SwapTransition {
  /** False: the new view simply replaces the old. True: they crossfade. */
  animate: boolean;
}

/**
 * How a change of view should look.
 *
 * Only a swap the user made animates. A mode set by a deep link or by the
 * launch-time restore is a correction to where the tab should be, and the
 * user did not ask to watch it happen: a widget tap that arrives on Upcoming
 * should show Upcoming, not Today sliding away first.
 */
export function swapTransition<M extends string>(input: {
  from: M;
  to: M;
  cause: ModeChangeCause;
  reduceMotion: boolean;
}): SwapTransition {
  const { from, to, cause, reduceMotion } = input;
  return { animate: from !== to && cause === 'swap' && !reduceMotion };
}

/**
 * The swap glyph's angle for a view: upright on the first of the pair, turned
 * over on the second.
 */
export function glyphAngle(flipped: boolean): number {
  return flipped ? 180 : 0;
}

export type GlyphTurn =
  /** Draw at `angle` and do nothing else. */
  | { animate: false; angle: number }
  /** Start at `from` and turn to `to`. */
  | { animate: true; from: number; to: number };

/**
 * How the glyph should arrive.
 *
 * The title remounts with the view it sits in, so the angle it was last drawn
 * at has to be remembered outside it (`rememberGlyphAngle`). The first title a
 * launch draws has no previous angle and simply appears.
 */
export function glyphTurn(input: {
  previous: number | undefined;
  flipped: boolean;
  reduceMotion: boolean;
}): GlyphTurn {
  const to = glyphAngle(input.flipped);
  if (input.previous === undefined || input.previous === to || input.reduceMotion) {
    return { animate: false, angle: to };
  }
  return { animate: true, from: input.previous, to };
}

const lastAngle: Partial<Record<SwapTab, number>> = {};

/** The angle a tab's glyph was last drawn at this launch, if any. */
export function lastGlyphAngle(tab: SwapTab): number | undefined {
  return lastAngle[tab];
}

export function rememberGlyphAngle(tab: SwapTab, angle: number): void {
  lastAngle[tab] = angle;
}

/** Test seam. */
export function resetGlyphAngles(): void {
  delete lastAngle.agenda;
  delete lastAngle.tasks;
}
