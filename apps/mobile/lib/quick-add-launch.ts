/**
 * Which door the quick-add surface was entered through.
 *
 * `QuickAddActivity` answers two URIs and behaves differently for each, but
 * nothing about the activity itself distinguishes them — the launch URI is the
 * only evidence, and it arrives as a string. Reading it wrong is silent in
 * both directions (a voice shortcut that opens the keyboard, or an "Add task"
 * tap that starts recording), which is why the match lives out here where a
 * test can hold it still.
 */

/** The scheme QuickAddActivity claims; MainActivity's `dodone` is separate. */
const QUICK_ADD_SCHEME = "dodoneadd";

/**
 * True when the launcher entry that opened the composer was "Voice task".
 *
 * Matched against the whole URI rather than parsed: `dodoneadd://voice` puts
 * "voice" in the *host*, and there is no path for a URL parser to find. The
 * `\b` is what keeps a future `dodoneadd://voicemail` from being read as this
 * one.
 */
export function isVoiceLaunch(url: string | null | undefined): boolean {
  if (!url) return false;
  return new RegExp(`^${QUICK_ADD_SCHEME}://voice\\b`, "i").test(url.trim());
}
