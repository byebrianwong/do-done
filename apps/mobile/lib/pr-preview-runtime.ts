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
import { prChannelName, prFromChannel } from './pr-preview';

export class PreviewUnavailableError extends Error {}

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
      throw new PreviewUnavailableError(
        result.reason ===
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
