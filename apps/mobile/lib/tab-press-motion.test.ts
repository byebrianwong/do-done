import { describe, expect, it } from 'vitest';

import {
  TAB_PRESS_DIP_MS,
  TAB_PRESS_DIP_SCALE,
  TAB_PRESS_SPRING,
  TAB_RIPPLE_FROM_SCALE,
  TAB_RIPPLE_MS,
  TAB_RIPPLE_OPACITY,
  TAB_RIPPLE_RISE,
  TAB_RIPPLE_SIZE,
  pressedIconScale,
  rippleOpacity,
  rippleScale,
} from './tab-press-motion';
import {
  TAB_BAR_MINIMIZED_ROW_HEIGHT,
  TAB_ICON_MINIMIZED_SCALE,
  TAB_ICON_SIZE,
  tabIconScale,
} from './tab-bar-motion';

describe('rippleOpacity', () => {
  it('draws nothing at either resting point', () => {
    // Both ends matter: the value sits at 1 between presses, so a non-zero
    // tail would leave a permanent wash under every tab.
    expect(rippleOpacity(0)).toBe(0);
    expect(rippleOpacity(1)).toBe(0);
  });

  it('peaks at the end of the rise', () => {
    expect(rippleOpacity(TAB_RIPPLE_RISE)).toBeCloseTo(TAB_RIPPLE_OPACITY, 6);
  });

  it('arrives far faster than it clears', () => {
    // The press must read as instant; the clearing is what the eye follows.
    expect(TAB_RIPPLE_RISE).toBeLessThan(1 - TAB_RIPPLE_RISE);
  });

  it('never exceeds the peak, and never goes negative', () => {
    for (let t = -0.5; t <= 1.5; t += 0.01) {
      const a = rippleOpacity(t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(TAB_RIPPLE_OPACITY + 1e-9);
    }
  });
});

describe('rippleScale', () => {
  it('grows from a disc smaller than the icon to one larger than it', () => {
    expect(TAB_RIPPLE_SIZE * TAB_RIPPLE_FROM_SCALE).toBeLessThan(TAB_ICON_SIZE);
    expect(TAB_RIPPLE_SIZE).toBeGreaterThan(TAB_ICON_SIZE);
  });

  it('is still growing after the alpha has peaked', () => {
    // A disc that stopped at the peak would blink out at full size instead of
    // reading as a ring spreading and thinning.
    expect(rippleScale(1)).toBeGreaterThan(rippleScale(TAB_RIPPLE_RISE));
  });

  it('runs from the start scale to full size and clamps outside', () => {
    expect(rippleScale(0)).toBeCloseTo(TAB_RIPPLE_FROM_SCALE, 6);
    expect(rippleScale(1)).toBeCloseTo(1, 6);
    expect(rippleScale(-1)).toBeCloseTo(TAB_RIPPLE_FROM_SCALE, 6);
    expect(rippleScale(2)).toBeCloseTo(1, 6);
  });
});

describe('the ripple fits the bar it is drawn in', () => {
  it('is not so large that a minimized row hides it', () => {
    // The row clips it, which is the bounded-ripple look. What must not happen
    // is the 30pt minimized row clipping away most of the disc.
    expect(TAB_RIPPLE_SIZE).toBeLessThanOrEqual(
      TAB_BAR_MINIMIZED_ROW_HEIGHT + 12
    );
  });

  it('outlives a tap but clears before the next screen settles', () => {
    expect(TAB_RIPPLE_MS).toBeGreaterThan(TAB_PRESS_DIP_MS * 2);
    expect(TAB_RIPPLE_MS).toBeLessThan(600);
  });
});

describe('the press pop', () => {
  it('dips before it springs, and the dip is the shorter half', () => {
    expect(TAB_PRESS_DIP_SCALE).toBeLessThan(1);
    expect(TAB_PRESS_DIP_MS).toBeLessThan(TAB_RIPPLE_MS / 2);
  });

  it('is underdamped, so the icon overshoots on the way back', () => {
    // ζ = damping / (2 * sqrt(stiffness * mass)). Below 1 is what makes this a
    // pop rather than the icon sagging and recovering.
    const zeta =
      TAB_PRESS_SPRING.damping /
      (2 * Math.sqrt(TAB_PRESS_SPRING.stiffness * TAB_PRESS_SPRING.mass));
    expect(zeta).toBeLessThan(1);
    expect(zeta).toBeGreaterThan(0.4);
  });
});

describe('pressedIconScale', () => {
  it('leaves the icon alone when nothing is happening', () => {
    expect(pressedIconScale(tabIconScale(0), 1)).toBe(1);
  });

  it('keeps both factors while the bar minimizes under a press', () => {
    // Picking one over the other would snap the icon to the other's resting
    // size for the length of the press.
    expect(pressedIconScale(tabIconScale(1), TAB_PRESS_DIP_SCALE)).toBeCloseTo(
      TAB_ICON_MINIMIZED_SCALE * TAB_PRESS_DIP_SCALE,
      6
    );
  });
});
