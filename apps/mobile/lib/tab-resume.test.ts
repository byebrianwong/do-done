import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));

import {
  holdIndexBlank,
  resumeDecision,
  resumePath,
  resumeScreenAnimation,
  resetResumeTried,
  hasResumeTried,
  markResumeTried,
} from './tab-resume';

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

describe('holdIndexBlank', () => {
  const base = {
    remembered: 'a' as string | null | undefined,
    known: ['a', 'b'] as string[] | null,
    alreadyTried: false,
    failed: false,
    gaveUp: false,
  };

  it('holds while the restore is about to cover the index', () => {
    expect(holdIndexBlank(base)).toBe(true);
  });

  it('holds while the memory is being read and while the ids load', () => {
    expect(holdIndexBlank({ ...base, remembered: undefined })).toBe(true);
    expect(holdIndexBlank({ ...base, known: null })).toBe(true);
  });

  it('draws the index when there is nothing to restore', () => {
    expect(holdIndexBlank({ ...base, remembered: null })).toBe(false);
    expect(holdIndexBlank({ ...base, remembered: 'gone' })).toBe(false);
  });

  it('draws the index once the restore has had its turn', () => {
    expect(holdIndexBlank({ ...base, alreadyTried: true })).toBe(false);
  });

  // `resumeDecision` waits forever while the ids never arrive, so these two are
  // what keep the tab from being stranded blank.
  it('never stays blank after a failed read or the time limit', () => {
    expect(holdIndexBlank({ ...base, known: null, failed: true })).toBe(false);
    expect(holdIndexBlank({ ...base, known: null, gaveUp: true })).toBe(false);
    expect(holdIndexBlank({ ...base, remembered: undefined, gaveUp: true })).toBe(false);
  });
});

describe('the quiet restore push', () => {
  it('flags the path only when the index was held blank', () => {
    expect(resumePath('lists', 'abc', true)).toBe('/lists/abc?resume=1');
    expect(resumePath('projects', 'abc', false)).toBe('/projects/abc');
  });

  it('pushes a flagged screen with no animation and everything else with the default', () => {
    expect(resumeScreenAnimation({ resume: '1' })).toBe('none');
    expect(resumeScreenAnimation({ id: 'abc' })).toBe('default');
    expect(resumeScreenAnimation(undefined)).toBe('default');
  });
});
