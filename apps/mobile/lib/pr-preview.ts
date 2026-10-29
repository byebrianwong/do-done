/**
 * Loading a pull request's JS bundle on an installed build.
 *
 * Each pull request that touches the mobile app is published by CI as an EAS
 * update on its own channel, `pr-<number>` (`.github/workflows/eas-update-pr.yml`).
 * The installed build is switched onto that channel by overriding the
 * `expo-channel-name` request header, and switched back by clearing the
 * override. expo-updates persists the override across launches, so a preview
 * stays loaded until it is left.
 *
 * This module is the pure half: naming, parsing and the availability rule. It
 * does not import expo-updates, so the node suite can test it. The calls that
 * actually switch channel are in `pr-preview-runtime.ts`.
 */

export const PR_CHANNEL_PREFIX = 'pr-';

/**
 * The repository the preview screen lists pull requests from. It is public, so
 * the list is read from GitHub's API with no token: 60 requests an hour per
 * network, and the screen makes one each time it opens or is refreshed.
 */
export const PREVIEW_REPO = 'byebrianwong/do-done';

/** The EAS channel CI publishes pull request `n` to. */
export function prChannelName(n: number): string {
  return `${PR_CHANNEL_PREFIX}${n}`;
}

/** The pull request a channel belongs to, or null for any other channel. */
export function prFromChannel(channel: string | null | undefined): number | null {
  if (!channel || !channel.startsWith(PR_CHANNEL_PREFIX)) return null;
  return toPrNumber(channel.slice(PR_CHANNEL_PREFIX.length));
}

/**
 * Read a pull request number out of whatever was pasted or typed.
 *
 * Accepts `123`, `#123`, `pr-123` and a GitHub pull request URL, because the
 * PR comment and the GitHub app both make the URL the easiest thing to copy.
 */
export function parsePrNumber(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  const fromUrl = /\/pull\/(\d+)/.exec(text);
  if (fromUrl) return toPrNumber(fromUrl[1]);
  const bare = /^(?:#|pr-?)?(\d+)$/i.exec(text);
  return bare ? toPrNumber(bare[1]) : null;
}

function toPrNumber(digits: string): number | null {
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** An open pull request, as the preview screen lists it. */
export interface PreviewablePullRequest {
  number: number;
  title: string;
  /**
   * The description's "How to try it" section, without the line that explains
   * how to load the preview (the screen does that), or null if there is none.
   */
  howToTry: string | null;
  draft: boolean;
}

const HOW_TO_TRY_HEADING = /^#{1,6}[ \t]+How to try it[ \t]*#*[ \t]*$/im;
const NEXT_SECTION = /^#{1,2}[ \t]+\S/m;
const LOADING_LINE = /^Load this PR on the phone\b/i;

/**
 * The "How to try it" section of a pull request description.
 *
 * Every PR in the smoothness series has one, between "Why" and "Verification".
 * Its first paragraph says how to load the preview, which is what the screen
 * showing it already does, so that paragraph is dropped.
 */
export function howToTrySection(body: string | null | undefined): string | null {
  if (!body) return null;
  // A description edited in GitHub's web UI comes back with \r\n line endings.
  const text = body.replace(/\r\n?/g, '\n');
  const heading = HOW_TO_TRY_HEADING.exec(text);
  if (!heading) return null;
  let rest = text.slice(heading.index + heading[0].length);
  const next = NEXT_SECTION.exec(rest);
  if (next) rest = rest.slice(0, next.index);
  const paragraphs = rest.trim().split(/\n[ \t]*\n/);
  if (paragraphs.length > 0 && LOADING_LINE.test(paragraphs[0].trim())) {
    paragraphs.shift();
  }
  const section = paragraphs.join('\n\n').trim();
  return section === '' ? null : section;
}

/**
 * Read GitHub's "list pull requests" response into what the screen draws.
 *
 * Pull requests from forks are dropped, because CI publishes no preview for
 * them. Ones with testing steps come first, then newest first. Anything that
 * does not look like a pull request is skipped rather than thrown on, so one
 * odd entry cannot empty the list.
 */
export function parsePullRequestList(
  json: unknown,
  repo: string = PREVIEW_REPO
): PreviewablePullRequest[] {
  if (!Array.isArray(json)) return [];
  const pulls: PreviewablePullRequest[] = [];
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const pr = item as Record<string, unknown>;
    if (typeof pr.number !== 'number' || typeof pr.title !== 'string') continue;
    const head = pr.head as { repo?: { full_name?: unknown } | null } | undefined;
    if (head?.repo?.full_name !== repo) continue;
    pulls.push({
      number: pr.number,
      title: pr.title,
      howToTry: howToTrySection(typeof pr.body === 'string' ? pr.body : null),
      draft: pr.draft === true,
    });
  }
  return pulls.sort(
    (a, b) =>
      Number(b.howToTry !== null) - Number(a.howToTry !== null) ||
      b.number - a.number
  );
}

export interface PreviewAvailabilityInput {
  /** `Updates.isEnabled`: false in a dev client and in Expo Go. */
  updatesEnabled: boolean;
  /** `__DEV__`. */
  isDev: boolean;
  /** `Updates.channel` as the build was configured, before any override. */
  channel: string | null | undefined;
}

/**
 * Whether this build can switch to a pull request's channel.
 *
 * Never on a production build: a store install must only ever run what was
 * shipped to the store. Not in development either, because a dev client loads
 * its bundle from Metro or from a URL, and expo-updates' header override is not
 * how it picks one.
 */
export function canPreviewPullRequests({
  updatesEnabled,
  isDev,
  channel,
}: PreviewAvailabilityInput): boolean {
  if (!updatesEnabled || isDev) return false;
  return channel !== 'production';
}
