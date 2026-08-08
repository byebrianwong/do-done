/**
 * The decisions a voice recording makes, as pure functions.
 *
 * `useVoiceCapture` is a hook around a native module, so none of it runs in CI
 * — `apps/mobile` has no renderer and no device. What *can* be checked here is
 * the part that is only sequencing: how a stream of partial and final results
 * becomes one transcript, when a session is finished enough to hand over, and
 * which recogniser errors are worth showing a user. Every one of those has a
 * failure mode that is invisible on a device (a transcript that quietly
 * repeats itself, a recording that never completes) so they live out here
 * where a test can reach them.
 */

/** How a transcript looks mid-recording: settled text plus an in-flight guess. */
export interface TranscriptState {
  /** Results the recogniser has committed to. */
  committed: string;
  /** The current utterance's running guess, replaced on every partial result. */
  partial: string;
}

export const EMPTY_TRANSCRIPT: TranscriptState = { committed: "", partial: "" };

/** The shape of a `result` event, narrowed to what this module reads. */
export interface RecognitionResultEvent {
  isFinal: boolean;
  results?: { transcript?: string }[];
}

/**
 * Fold a final result into the committed text.
 *
 * The two recognisers disagree about what a final result contains. Android's
 * continuous mode emits one per utterance, carrying only that utterance;
 * iOS hands back everything said so far, every time. Appending blindly would
 * make an iOS dictation stutter — "buy milk buy milk and bread" — and
 * replacing blindly would throw away every Android segment but the last.
 *
 * The prefix is what tells them apart, and it needs no platform check: a
 * result that already contains what we have is the accumulating kind and
 * replaces; anything else is a new segment and appends.
 */
function commit(committed: string, text: string): string {
  if (!text) return committed;
  if (!committed) return text;
  if (text.startsWith(committed)) return text;
  return `${committed} ${text}`;
}

/** Apply one `result` event to the running transcript. */
export function applyResult(
  state: TranscriptState,
  event: RecognitionResultEvent
): TranscriptState {
  const text = (event.results?.[0]?.transcript ?? "").trim();
  if (!event.isFinal) return { ...state, partial: text };
  // A final result ends the utterance, so the partial it was refining is
  // superseded rather than kept alongside.
  return { committed: commit(state.committed, text), partial: "" };
}

/**
 * What to show, and what to keep.
 *
 * The partial is included so the user watches their words appear as they
 * speak — a recorder that shows nothing until it stops reads as broken — and
 * it is included on stop too, because Android's last partial is sometimes all
 * there is when a recognition is cut short.
 */
export function transcriptText(state: TranscriptState): string {
  return commit(state.committed, state.partial).trim();
}

/**
 * The recogniser's volume, mapped onto 0..1 for a level meter.
 *
 * It reports roughly -2..10, where anything below 0 is inaudible. Clamping the
 * bottom at 0 rather than stretching the full range is what keeps a quiet room
 * from drawing a lively meter.
 */
export function normalizeLevel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / 10));
}

/**
 * A session hands its result over only once the recogniser has stopped *and*
 * the audio file is closed.
 *
 * `end` and `audioend` arrive in either order, and the file is explicitly not
 * safe to read before `audioend` — uploading on `end` alone would sometimes
 * ship a truncated WAV, which is the kind of bug that reproduces on one phone
 * and not another.
 */
export function isSessionComplete(flags: {
  ended: boolean;
  audioClosed: boolean;
}): boolean {
  return flags.ended && flags.audioClosed;
}

/**
 * A recogniser error code as a sentence, or null when there is nothing to say.
 *
 * Two codes are deliberately silent. `aborted` is the user cancelling — they
 * know. `no-speech` is handled by the caller, which keeps whatever audio was
 * captured rather than treating an unrecognised recording as a failure: the
 * whole point of storing the audio is that the transcript is the fallible part.
 */
export function recognitionErrorMessage(code: string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "no-speech":
      return "Didn't catch that — the recording is still attached.";
    case "not-allowed":
    case "service-not-allowed":
      return "DoDone needs microphone and speech access to record.";
    case "network":
      return "Transcribing needs a connection right now.";
    case "language-not-supported":
      return "That language isn't available for transcription on this device.";
    case "busy":
      return "The recogniser is busy — try again in a moment.";
    case "audio-capture":
      return "Couldn't reach the microphone.";
    case "interrupted":
      return "Recording was interrupted.";
    default:
      return "Couldn't transcribe that.";
  }
}
