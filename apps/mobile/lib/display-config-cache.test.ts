import { describe, it, expect, beforeEach } from 'vitest';
import { defaultDisplayFor, type DisplayConfig } from '@do-done/shared';

import {
  hasDisplayConfig,
  initialDisplayConfig,
  markDisplayConfigWritten,
  rememberDisplayConfig,
  resetDisplayConfigCache,
  sameDisplayConfig,
  shouldApplyRemoteConfig,
} from './display-config-cache';

describe('display config cache', () => {
  beforeEach(() => resetDisplayConfigCache());

  it('starts a view on its defaults before anything is known', () => {
    const fallback = defaultDisplayFor('all');
    expect(initialDisplayConfig('all', fallback)).toBe(fallback);
    expect(hasDisplayConfig('all')).toBe(false);
  });

  it('starts a remount from what the view last used, not the defaults', () => {
    const fallback = defaultDisplayFor('today');
    const custom: DisplayConfig = { ...fallback, showCompleted: !fallback.showCompleted };
    rememberDisplayConfig('today', custom);
    expect(initialDisplayConfig('today', fallback)).toBe(custom);
    // Per view: another key is untouched.
    const inbox = defaultDisplayFor('inbox');
    expect(initialDisplayConfig('inbox', inbox)).toBe(inbox);
  });

  it('treats configs with the same values as the same, whatever their key order', () => {
    const a = defaultDisplayFor('all');
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as DisplayConfig;
    expect(sameDisplayConfig(a, reordered)).toBe(true);
    expect(sameDisplayConfig(a, { ...a, showCompleted: !a.showCompleted })).toBe(false);
  });

  it('stops applying the database copy once the user has changed the view here', () => {
    expect(shouldApplyRemoteConfig('all')).toBe(true);
    markDisplayConfigWritten('all');
    expect(shouldApplyRemoteConfig('all')).toBe(false);
    expect(shouldApplyRemoteConfig('inbox')).toBe(true);
  });
});
