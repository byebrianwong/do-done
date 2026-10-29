import { afterEach, describe, expect, it } from 'vitest';

import {
  LOCAL_RECONCILE_WINDOW_MS,
  isLocalReconcile,
  noteLocalWrite,
  resetLocalWrite,
} from './local-write';

afterEach(() => resetLocalWrite());

describe('isLocalReconcile', () => {
  it('is false before anything has been written, so a cold start shows the bar', () => {
    expect(isLocalReconcile(1_000)).toBe(false);
  });

  it('is true for a fetch that starts right after a local write', () => {
    noteLocalWrite(10_000);
    expect(isLocalReconcile(10_050)).toBe(true);
  });

  it('is false once the window has passed, so a later refresh shows the bar', () => {
    noteLocalWrite(10_000);
    expect(isLocalReconcile(10_000 + LOCAL_RECONCILE_WINDOW_MS)).toBe(false);
  });

  it('each write restarts the window', () => {
    noteLocalWrite(0);
    noteLocalWrite(1_000);
    expect(isLocalReconcile(1_000 + LOCAL_RECONCILE_WINDOW_MS - 1)).toBe(true);
  });
});
