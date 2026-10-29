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
