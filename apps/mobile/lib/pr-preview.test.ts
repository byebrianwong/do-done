import { describe, expect, it } from 'vitest';
import {
  canPreviewPullRequests,
  howToTrySection,
  parsePrNumber,
  parsePullRequestList,
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

describe('howToTrySection', () => {
  const body = [
    '## What changed',
    '',
    'Something.',
    '',
    '## How to try it',
    '',
    'Load this PR on the phone: Settings → App version → Preview a pull request → 329, or scan the QR code.',
    '',
    '1. **Swipe → Tomorrow.** Main: the row jumps. This PR: it fades.',
    '2. **Reduce Motion.** Lands on the end state.',
    '',
    '### A sub-heading stays in',
    '',
    'Detail.',
    '',
    '## Verification',
    '',
    '- tsc passes',
  ].join('\n');

  it('returns the section without the loading paragraph', () => {
    const section = howToTrySection(body);
    expect(section).toBe(
      [
        '1. **Swipe → Tomorrow.** Main: the row jumps. This PR: it fades.',
        '2. **Reduce Motion.** Lands on the end state.',
        '',
        '### A sub-heading stays in',
        '',
        'Detail.',
      ].join('\n')
    );
  });

  it('reads a description with \\r\\n line endings', () => {
    expect(howToTrySection(body.replace(/\n/g, '\r\n'))).toBe(howToTrySection(body));
  });

  it('runs to the end when it is the last section', () => {
    expect(howToTrySection('## How to try it\n\nOpen Today.')).toBe('Open Today.');
  });

  it('is null when there is no section, or nothing in it but the loading line', () => {
    expect(howToTrySection('## What changed\n\nStuff.')).toBeNull();
    expect(howToTrySection(null)).toBeNull();
    expect(
      howToTrySection('## How to try it\n\nLoad this PR on the phone: Settings.\n\n## Verification')
    ).toBeNull();
  });
});

describe('parsePullRequestList', () => {
  const pr = (number: number, body: string | null, repo: string | null = 'byebrianwong/do-done') => ({
    number,
    title: `PR ${number}`,
    body,
    draft: true,
    head: { repo: repo === null ? null : { full_name: repo } },
  });

  it('puts PRs with testing steps first, newest first within each group', () => {
    const list = parsePullRequestList([
      pr(10, '## How to try it\n\nA.'),
      pr(12, null),
      pr(11, '## How to try it\n\nB.'),
    ]);
    expect(list.map((p) => p.number)).toEqual([11, 10, 12]);
    expect(list[0]).toEqual({ number: 11, title: 'PR 11', howToTry: 'B.', draft: true });
  });

  it('drops forks and entries that are not pull requests', () => {
    const list = parsePullRequestList([
      pr(1, null, 'someone/do-done'),
      pr(2, null, null),
      { title: 'no number' },
      null,
      pr(3, null),
    ]);
    expect(list.map((p) => p.number)).toEqual([3]);
  });

  it('is empty for anything that is not a list', () => {
    expect(parsePullRequestList({ message: 'API rate limit exceeded' })).toEqual([]);
  });
});
