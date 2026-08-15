import { describe, expect, it } from 'vitest';

import { rowLongPressAction, rowTapAction } from './row-gesture';

describe('rowTapAction', () => {
  it('opens the editor by default', () => {
    expect(rowTapAction({ selecting: false })).toBe('open');
  });

  it('picks the row while selection is armed', () => {
    expect(rowTapAction({ selecting: true })).toBe('toggle-selection');
  });
});

describe('rowLongPressAction', () => {
  it('starts a drag on a list that can reorder', () => {
    expect(rowLongPressAction({ selecting: false, draggable: true })).toBe(
      'drag'
    );
  });

  it('does nothing on a list that cannot', () => {
    expect(rowLongPressAction({ selecting: false, draggable: false })).toBe(
      'none'
    );
  });

  it('never drags while selecting, even on a draggable list', () => {
    // The row is a selection target in that mode — a drop would rewrite the
    // task the user is in the middle of picking.
    expect(rowLongPressAction({ selecting: true, draggable: true })).toBe(
      'none'
    );
  });

  it('does not hand the hold back to selection', () => {
    // The regression this guards: the hold used to enter selection mode, which
    // is exactly what cost the row its drag gesture and forced a grab handle.
    const actions = [true, false].flatMap((selecting) =>
      [true, false].map((draggable) =>
        rowLongPressAction({ selecting, draggable })
      )
    );
    expect(actions).not.toContain('toggle-selection');
  });
});
