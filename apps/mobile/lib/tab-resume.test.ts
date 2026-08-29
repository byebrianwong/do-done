import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));

import { resumeDecision, resetResumeTried, hasResumeTried, markResumeTried } from './tab-resume';

describe('resumeDecision', () => {
  it('waits while the ids are still loading', () => {
    expect(
      resumeDecision({ remembered: 'a', known: null, alreadyTried: false })
    ).toEqual({ action: 'wait' });
  });

  it('opens the remembered screen when it still exists', () => {
    expect(
      resumeDecision({ remembered: 'a', known: ['a', 'b'], alreadyTried: false })
    ).toEqual({ action: 'open', id: 'a' });
  });

  it('forgets a target that no longer exists rather than stranding the tab', () => {
    expect(
      resumeDecision({ remembered: 'gone', known: ['a'], alreadyTried: false })
    ).toEqual({ action: 'forget' });
  });

  it('stays put when there is nothing remembered', () => {
    expect(
      resumeDecision({ remembered: null, known: ['a'], alreadyTried: false })
    ).toEqual({ action: 'stay' });
  });

  it('never opens twice in a session — the second visit IS the index', () => {
    // Backing out to the index, or re-tapping the tab, must not bounce
    // straight back into the list the user just left.
    expect(
      resumeDecision({ remembered: 'a', known: ['a'], alreadyTried: true })
    ).toEqual({ action: 'forget' });
  });

  it('does not write when there is nothing to clear', () => {
    expect(
      resumeDecision({ remembered: null, known: ['a'], alreadyTried: true })
    ).toEqual({ action: 'stay' });
  });

  it('decides on the ids, not on an empty list arriving first', () => {
    // An account with no lists at all: the memory is stale by definition.
    expect(
      resumeDecision({ remembered: 'a', known: [], alreadyTried: false })
    ).toEqual({ action: 'forget' });
  });
});

describe('the once-per-launch flag', () => {
  beforeEach(() => resetResumeTried());

  it('is per section', () => {
    markResumeTried('lists');
    expect(hasResumeTried('lists')).toBe(true);
    expect(hasResumeTried('projects')).toBe(false);
  });

  it('starts clear on a fresh launch', () => {
    markResumeTried('projects');
    resetResumeTried();
    expect(hasResumeTried('projects')).toBe(false);
  });
});
