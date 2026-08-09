/**
 * Why `Updates.checkForUpdateAsync()` came back with nothing, in words.
 *
 * "No update available" covers several very different situations, and only one
 * of them means you're current. It flattened into a single cheerful "You're
 * running the latest published version" — which is what it said to a build
 * pinned three weeks behind because every newer bundle imported a native module
 * that build didn't have: the update downloaded, threw on launch, rolled back,
 * and was then never offered again (`failedLaunchCount > 0`). The app insisted
 * it was up to date while running the last bundle that could still start.
 *
 * Each reason gets a sentence that says what to do about it, because none of
 * them are fixable from inside the app: a previously-failed update and an empty
 * channel both need someone to look at the build.
 *
 * Typed against the string values of expo-updates'
 * `UpdateCheckResultNotAvailableReason` rather than the enum itself, so this
 * stays a plain module the node test suite can import — `expo-updates` reaches
 * for native code the moment it loads.
 */
export type UpdateNotAvailableReason =
  | 'noUpdateAvailableOnServer'
  | 'updateRejectedBySelectionPolicy'
  | 'updatePreviouslyFailed'
  | 'rollbackRejectedBySelectionPolicy'
  | 'rollbackNoEmbeddedConfiguration';

export interface UpdateCheckMessage {
  title: string;
  body: string;
}

export function describeNoUpdate(
  reason: string | undefined,
  channel: string
): UpdateCheckMessage {
  switch (reason) {
    case 'noUpdateAvailableOnServer':
      return {
        title: 'Up to date',
        body: `Nothing newer has been published to the “${channel}” channel.`,
      };
    case 'updatePreviouslyFailed':
      return {
        title: 'Update can’t be applied',
        body:
          'A newer version was downloaded but failed to start, so this build ' +
          'has gone back to the last one that works and won’t retry it. That ' +
          'usually means the update needs native code this build doesn’t ' +
          'have — it needs a new install, not an over-the-air update.',
      };
    case 'updateRejectedBySelectionPolicy':
    case 'rollbackRejectedBySelectionPolicy':
      return {
        title: 'Update not applied',
        body:
          'The server offered a version this build won’t take — usually a ' +
          'runtime version mismatch, which needs a new install rather than an ' +
          'over-the-air update.',
      };
    case 'rollbackNoEmbeddedConfiguration':
      return {
        title: 'Update not applied',
        body:
          'The server asked this build to roll back to its built-in version, ' +
          'and there isn’t one to roll back to.',
      };
    default:
      // An older expo-updates, or a reason added after this was written. Don't
      // claim currency we can't vouch for.
      return {
        title: 'No update available',
        body: `Nothing new was applied from the “${channel}” channel.`,
      };
  }
}
