/**
 * Switch this install onto a pull request's update channel, and back.
 *
 * The rules live in `pr-preview.ts`; this file is only the expo-updates calls,
 * which reach native code the moment the module loads and so cannot run in the
 * node suite.
 *
 * Why switching back works even though the preview is older: expo-updates loads
 * an update regardless of its age when the running one does not match the
 * manifest filters of the channel it just asked, and EAS filters by branch. So
 * leaving a preview published last week still lands on today's main build.
 */
import * as Updates from 'expo-updates';

import { describeNoUpdate } from './update-check';
import {
  parsePullRequestList,
  prChannelName,
  prFromChannel,
  PREVIEW_REPO,
  type PreviewablePullRequest,
} from './pr-preview';

export class PreviewUnavailableError extends Error {}

/**
 * The repository's open pull requests, newest with testing steps first.
 *
 * One unauthenticated request. GitHub allows 60 an hour per network and
 * answers 403 or 429 past that, which is reported in words, since the screen
 * still works by number without the list.
 */
export async function fetchOpenPullRequests(
  signal?: AbortSignal
): Promise<PreviewablePullRequest[]> {
  const res = await fetch(
    `https://api.github.com/repos/${PREVIEW_REPO}/pulls?state=open&per_page=50`,
    { headers: { Accept: 'application/vnd.github+json' }, signal }
  );
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      'GitHub has had too many requests from this network in the last hour. Try again later, or enter a number below.'
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub answered ${res.status}. Try again, or enter a number below.`);
  }
  return parsePullRequestList(await res.json());
}

/**
 * Load pull request `n`'s published bundle and restart into it.
 *
 * Throws `PreviewUnavailableError` with a readable message when nothing has
 * been published for it yet, after putting the override back so the install
 * is left on the channel it was on.
 */
export async function enterPullRequestPreview(
  n: number,
  previousChannel: string | null
): Promise<void> {
  Updates.setUpdateRequestHeadersOverride({
    'expo-channel-name': prChannelName(n),
  });
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      // Loading the PR that is already running asks for its newest push, and
      // "nothing newer" is the answer when there is none.
      throw new PreviewUnavailableError(
        prFromChannel(previousChannel) === n
          ? `This phone already has the newest build of PR #${n}.`
          : result.reason ===
              Updates.UpdateCheckResultNotAvailableReason.NO_UPDATE_AVAILABLE_ON_SERVER
            ? `Nothing has been published for PR #${n} yet. The preview job runs a few minutes after each push to the PR.`
            : describeNoUpdate(result.reason, prChannelName(n)).body
      );
    }
    await Updates.fetchUpdateAsync();
  } catch (e) {
    restoreChannel(previousChannel);
    throw e;
  }
  await Updates.reloadAsync();
}

/** Drop the override, load the build's own channel again, and restart. */
export async function leavePullRequestPreview(): Promise<void> {
  Updates.setUpdateRequestHeadersOverride(null);
  // Fetching first also refreshes the stored manifest filters, which is what
  // makes the launcher pick the build's own channel after the reload, even
  // when that update is already on disk and nothing new is downloaded.
  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
}

/**
 * Put back whatever the install was on before a failed switch. A preview that
 * fails to load while another preview is running should leave the first one
 * running, not drop the user onto main.
 */
function restoreChannel(previousChannel: string | null): void {
  const previous = prFromChannel(previousChannel);
  Updates.setUpdateRequestHeadersOverride(
    previous === null ? null : { 'expo-channel-name': prChannelName(previous) }
  );
}
