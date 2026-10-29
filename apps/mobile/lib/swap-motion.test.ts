import { describe, it, expect, beforeEach } from 'vitest';

import {
  SWAP_ORDER,
  glyphTurn,
  lastGlyphAngle,
  rememberGlyphAngle,
  resetGlyphAngles,
  swapTransition,
} from './swap-motion';

describe('swapTransition', () => {
  const base = { order: SWAP_ORDER.agenda, cause: 'swap' as const, reduceMotion: false };

  it('slides forward into the second view of the pair', () => {
    expect(swapTransition({ ...base, from: 'today', to: 'upcoming' })).toEqual({
      animate: true,
      direction: 'forward',
    });
  });

  it('slides back into the first view', () => {
    expect(swapTransition({ ...base, from: 'upcoming', to: 'today' })).toEqual({
      animate: true,
      direction: 'back',
    });
  });

  it('uses each tab’s own order', () => {
    expect(
      swapTransition({ ...base, order: SWAP_ORDER.tasks, from: 'all', to: 'inbox' })
    ).toEqual({ animate: true, direction: 'forward' });
  });

  it('does not animate a mode a deep link or the restore set', () => {
    expect(
      swapTransition({ ...base, cause: 'set', from: 'today', to: 'upcoming' })
    ).toEqual({ animate: false });
  });

  it('lands on the end state under Reduce Motion', () => {
    expect(
      swapTransition({ ...base, reduceMotion: true, from: 'today', to: 'upcoming' })
    ).toEqual({ animate: false });
  });

  it('does nothing when nothing changed', () => {
    expect(swapTransition({ ...base, from: 'today', to: 'today' })).toEqual({
      animate: false,
    });
  });
});

describe('glyphTurn', () => {
  beforeEach(() => resetGlyphAngles());

  it('draws the first title of a launch at its angle, without turning', () => {
    expect(glyphTurn({ previous: undefined, flipped: true, reduceMotion: false })).toEqual({
      animate: false,
      angle: 180,
    });
  });

  it('turns over from where the previous title left it', () => {
    expect(glyphTurn({ previous: 0, flipped: true, reduceMotion: false })).toEqual({
      animate: true,
      from: 0,
      to: 180,
    });
    expect(glyphTurn({ previous: 180, flipped: false, reduceMotion: false })).toEqual({
      animate: true,
      from: 180,
      to: 0,
    });
  });

  it('does not turn when the angle has not changed', () => {
    expect(glyphTurn({ previous: 0, flipped: false, reduceMotion: false })).toEqual({
      animate: false,
      angle: 0,
    });
  });

  it('lands on the end angle under Reduce Motion', () => {
    expect(glyphTurn({ previous: 0, flipped: true, reduceMotion: true })).toEqual({
      animate: false,
      angle: 180,
    });
  });

  it('remembers an angle per tab, so the remounted title can start from it', () => {
    rememberGlyphAngle('agenda', 180);
    expect(lastGlyphAngle('agenda')).toBe(180);
    expect(lastGlyphAngle('tasks')).toBeUndefined();
  });
});
