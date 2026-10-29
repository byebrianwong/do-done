import { describe, expect, it } from 'vitest';
import { revealScrollDelta } from './keyboard-reveal';

// A body visible from y=100 to y=400 on screen, with 16dp of breathing room.
const view = { viewTop: 100, viewBottom: 400, margin: 16 };

describe('revealScrollDelta', () => {
  it('does nothing when the field is already on screen', () => {
    expect(revealScrollDelta({ ...view, fieldTop: 200, fieldBottom: 240 })).toBe(0);
  });

  it('scrolls up just enough to bring a field out from under the keyboard', () => {
    // Bottom edge at 450 must reach 400 - 16 = 384.
    expect(revealScrollDelta({ ...view, fieldTop: 410, fieldBottom: 450 })).toBe(66);
  });

  it('scrolls down when the field sits above the visible part', () => {
    // Top edge at 60 must reach 100 + 16 = 116.
    expect(revealScrollDelta({ ...view, fieldTop: 60, fieldBottom: 100 })).toBe(-56);
  });

  it('leaves a tall note alone while any of it is visible', () => {
    expect(revealScrollDelta({ ...view, fieldTop: 300, fieldBottom: 900 })).toBe(0);
  });

  it('brings the top of a tall note in when all of it is below the view', () => {
    expect(revealScrollDelta({ ...view, fieldTop: 450, fieldBottom: 1200 })).toBe(334);
  });

  it('does nothing when the view has no room left', () => {
    expect(
      revealScrollDelta({ viewTop: 100, viewBottom: 120, margin: 16, fieldTop: 500, fieldBottom: 540 })
    ).toBe(0);
  });
});
