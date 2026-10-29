import { describe, expect, it } from 'vitest';
import {
  METER_BAR_COUNT,
  METER_BAR_MIN,
  METER_BAR_RANGE,
  QUICK_ADD_SETTLE_DELAY_MS,
  meterBarHeight,
  quickAddOpenAction,
  recordingElapsed,
} from './quick-add-motion';

describe('quickAddOpenAction', () => {
  it('focuses while mounting in the in-app modal', () => {
    expect(
      quickAddOpenAction({ autoFocus: true, autoRecord: false, settled: true })
    ).toEqual({ kind: 'focus-on-mount' });
  });

  it('keeps the delay for the widget activity', () => {
    expect(
      quickAddOpenAction({ autoFocus: true, autoRecord: false, settled: false })
    ).toEqual({ kind: 'focus-later', delayMs: QUICK_ADD_SETTLE_DELAY_MS });
  });

  it('delays recording on both hosts', () => {
    for (const settled of [true, false]) {
      expect(
        quickAddOpenAction({ autoFocus: false, autoRecord: true, settled })
      ).toEqual({ kind: 'record-later', delayMs: QUICK_ADD_SETTLE_DELAY_MS });
    }
  });

  it('records rather than focusing when both are asked for', () => {
    expect(
      quickAddOpenAction({ autoFocus: true, autoRecord: true, settled: true }).kind
    ).toBe('record-later');
  });

  it('does nothing when neither is asked for', () => {
    expect(
      quickAddOpenAction({ autoFocus: false, autoRecord: false, settled: true })
    ).toEqual({ kind: 'none' });
  });
});

describe('meterBarHeight', () => {
  const centre = (METER_BAR_COUNT - 1) / 2;

  it('rests every bar at the minimum when silent', () => {
    for (let i = 0; i < METER_BAR_COUNT; i++) {
      expect(meterBarHeight(i, 0)).toBe(METER_BAR_MIN);
    }
  });

  it('peaks at the centre bar', () => {
    expect(meterBarHeight(centre, 1)).toBe(METER_BAR_MIN + METER_BAR_RANGE);
    expect(meterBarHeight(0, 1)).toBeLessThan(meterBarHeight(centre, 1));
  });

  it('is symmetric about the centre', () => {
    expect(meterBarHeight(0, 0.6)).toBeCloseTo(
      meterBarHeight(METER_BAR_COUNT - 1, 0.6)
    );
  });

  it('clamps a level outside 0..1', () => {
    expect(meterBarHeight(centre, 3)).toBe(meterBarHeight(centre, 1));
    expect(meterBarHeight(centre, -1)).toBe(METER_BAR_MIN);
  });
});

describe('recordingElapsed', () => {
  it('counts from the start', () => {
    expect(recordingElapsed(1_000, 4_500)).toBe(3_500);
  });

  it('never goes negative', () => {
    expect(recordingElapsed(5_000, 4_000)).toBe(0);
  });
});
