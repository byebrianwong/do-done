import { describe, it, expect, beforeEach } from 'vitest';

import {
  glyphTurn,
  lastGlyphAngle,
  rememberGlyphAngle,
  resetGlyphAngles,
  swapTransition,
} from './swap-motion';

describe('swapTransition', () => {
  const base = { cause: 'swap' as const, reduceMotion: false };

  it('crossfades a swap the user made', () => {
    expect(swapTransition({ ...base, from: 'today', to: 'upcoming' })).toEqual({ animate: true });
    expect(swapTransition({ ...base, from: 'inbox', to: 'all' })).toEqual({ animate: true });
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
