import { describe, expect, it } from 'vitest';
import {
  canPreviewPullRequests,
  parsePrNumber,
  prChannelName,
  prFromChannel,
} from './pr-preview';

describe('prChannelName / prFromChannel', () => {
  it('round-trips a pull request number', () => {
    expect(prChannelName(321)).toBe('pr-321');
    expect(prFromChannel(prChannelName(321))).toBe(321);
  });

  it('is null for every channel that is not a pull request', () => {
    expect(prFromChannel('preview')).toBeNull();
    expect(prFromChannel('production')).toBeNull();
    expect(prFromChannel('pr-')).toBeNull();
    expect(prFromChannel('pr-abc')).toBeNull();
    expect(prFromChannel(null)).toBeNull();
    expect(prFromChannel(undefined)).toBeNull();
  });
});

describe('parsePrNumber', () => {
  it('reads the forms the PR comment and GitHub hand out', () => {
    expect(parsePrNumber('321')).toBe(321);
    expect(parsePrNumber(' #321 ')).toBe(321);
    expect(parsePrNumber('pr-321')).toBe(321);
    expect(parsePrNumber('PR321')).toBe(321);
    expect(parsePrNumber('https://github.com/byebrianwong/do-done/pull/321')).toBe(321);
    expect(
      parsePrNumber('https://github.com/byebrianwong/do-done/pull/321/files')
    ).toBe(321);
  });

  it('rejects anything that is not a positive whole number', () => {
    expect(parsePrNumber('')).toBeNull();
    expect(parsePrNumber('0')).toBeNull();
    expect(parsePrNumber('-4')).toBeNull();
    expect(parsePrNumber('12.5')).toBeNull();
    expect(parsePrNumber('main')).toBeNull();
    expect(parsePrNumber('99999999999999999999')).toBeNull();
  });
});

describe('canPreviewPullRequests', () => {
  const release = { updatesEnabled: true, isDev: false };

  it('is available on a preview build', () => {
    expect(canPreviewPullRequests({ ...release, channel: 'preview' })).toBe(true);
  });

  it('stays available while a preview is loaded, so it can be left', () => {
    expect(canPreviewPullRequests({ ...release, channel: 'pr-12' })).toBe(true);
  });

  it('is never available on a production build', () => {
    expect(canPreviewPullRequests({ ...release, channel: 'production' })).toBe(false);
  });

  it('is not available in development or with updates off', () => {
    expect(
      canPreviewPullRequests({ updatesEnabled: true, isDev: true, channel: 'development' })
    ).toBe(false);
    expect(
      canPreviewPullRequests({ updatesEnabled: false, isDev: false, channel: 'preview' })
    ).toBe(false);
  });
});
