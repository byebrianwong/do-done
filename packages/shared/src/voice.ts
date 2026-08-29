/**
 * Voice notes — turning something spoken into a task.
 *
 * A recording produces two artefacts and DoDone keeps both: the audio, stored
 * as an ordinary attachment, and the transcript, which becomes the task's text.
 * Keeping the audio is part of the feature, not a nicety. A recogniser
 * mishears names and numbers constantly, so the recording is the
 * record of what was said and the transcript is a convenience over it.
 *
 * The split from one run of speech into a title and a description lives here,
 * not in either app, for the same reason `attachmentKind` does: a sentence that
 * became the title on the phone and the description on the web would look like
 * a bug in whichever surface the user tried second.
 */

import { fileExtension } from "./attachments.js";

/**
 * How long a single recording may run before it stops itself.
 *
 * The ceiling is really the attachment limit, not the clock: the recogniser
 * persists 16 kHz mono PCM, which is ~32 KB/s, so 10 MB is a little over five
 * minutes. Four leaves headroom for the header and for iOS's higher default
 * sample rate, and stopping at a round number the user can see counting up is
 * far kinder than uploading five minutes of speech and then rejecting it.
 */
export const VOICE_MAX_DURATION_MS = 4 * 60 * 1000;

/** How long before the cap the UI starts warning that time is nearly up. */
export const VOICE_WARN_REMAINING_MS = 30 * 1000;

/**
 * Longest title a transcript is allowed to produce.
 *
 * Past this the sentence stops being a task name and starts being a paragraph,
 * so the overflow goes to the description instead of making an unreadable row.
 */
export const VOICE_TITLE_MAX_CHARS = 100;

/**
 * Fewest words a sentence must have before a full stop after it is believed.
 *
 * Dictation puts a period on abbreviations too, so "Call Dr. Smith about the
 * quote" offers a boundary after "Call Dr" — obeying it would title the task
 * with half a name. Requiring three words means such a boundary is skipped and
 * the next real one is used, which is harmless on ordinary speech: a genuine
 * opening sentence shorter than three words is not a title worth keeping.
 */
const MIN_TITLE_WORDS = 3;

/** A sentence end: terminal punctuation followed by whitespace or the end. */
const SENTENCE_END = /[.!?…]+(?=\s|$)/g;

/** What a transcript becomes once it is split. */
export interface TranscriptSplit {
  /** The task's title. Empty only when the transcript itself was empty. */
  title: string;
  /** Everything after the title, or null when it all fitted in the title. */
  description: string | null;
}

/** Collapse the whitespace a recogniser sprinkles through a long dictation. */
function normalize(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(" ").length : 0;
}

/**
 * Split a spoken transcript into a title and a description.
 *
 * Two passes, in this order, because the two recognisers behave differently:
 *
 *  1. **Sentence boundary.** iOS punctuates by default and Android does with
 *     `addsPunctuation`, so "Buy milk. Get the oat one." has an obvious title
 *     already. The first boundary that yields a plausible title wins, and the
 *     title keeps no trailing punctuation — a full stop reads as a typo in a
 *     task row.
 *  2. **Length.** Android's default recogniser returns one unpunctuated run,
 *     so most transcripts reach here. Anything within the ceiling stays whole;
 *     anything longer is cut at the last word boundary before it, and the rest
 *     — including the words that didn't fit — becomes the description.
 *
 * A transcript that is short and unpunctuated therefore comes through
 * completely untouched, which is the common case: it is a one-line task, and
 * the quick-add parser still gets to read dates and `#tags` out of it.
 */
export function splitTranscript(raw: string): TranscriptSplit {
  const text = normalize(raw);
  if (!text) return { title: "", description: null };

  // Pass 1 — the first believable sentence end.
  SENTENCE_END.lastIndex = 0;
  for (
    let match = SENTENCE_END.exec(text);
    match !== null;
    match = SENTENCE_END.exec(text)
  ) {
    const head = text.slice(0, match.index).trim();
    if (head.length > VOICE_TITLE_MAX_CHARS) break; // and every later one is longer
    if (wordCount(head) < MIN_TITLE_WORDS) continue; // "Call Dr." — not a sentence
    const tail = text.slice(match.index + match[0].length).trim();
    // A sole trailing full stop isn't a split, it's punctuation: drop it and
    // keep the whole utterance as the title.
    return { title: head, description: tail || null };
  }

  // Pass 2 — no usable boundary, so fall back to length.
  if (text.length <= VOICE_TITLE_MAX_CHARS) {
    return { title: text, description: null };
  }

  // Cut at the last space at or before the ceiling. `lastIndexOf` is given
  // ceiling + 1 so a space landing exactly on the boundary is allowed to be
  // the cut, rather than dropping a whole word for the sake of one character.
  const cut = text.lastIndexOf(" ", VOICE_TITLE_MAX_CHARS);
  // A single word longer than the ceiling has no space to cut at. Rather than
  // slicing through it, keep it whole as the title — an over-long title is a
  // cosmetic problem, a word chopped in half is a wrong one.
  if (cut <= 0) {
    const firstSpace = text.indexOf(" ");
    if (firstSpace <= 0) return { title: text, description: null };
    return {
      title: text.slice(0, firstSpace),
      description: text.slice(firstSpace + 1).trim() || null,
    };
  }

  return {
    title: text.slice(0, cut).trim(),
    description: text.slice(cut + 1).trim() || null,
  };
}

/**
 * Append a transcript to a description that may already have one.
 *
 * Used by the task editor, where the task already has a title and a voice note
 * is an addition rather than the whole task. A blank line between them so two
 * dictations don't run into one sentence, and so the result stays valid
 * Markdown — descriptions render as Markdown on both surfaces.
 */
export function appendTranscript(
  existing: string | null | undefined,
  transcript: string
): string {
  const addition = normalize(transcript);
  if (!addition) return existing ?? "";
  const base = (existing ?? "").replace(/\s+$/, "");
  return base ? `${base}\n\n${addition}` : addition;
}

/**
 * MIME type for a recording, from its extension.
 *
 * The recogniser writes WAV on Android and can write CAF on iOS, and neither
 * platform tells us which — the only evidence is the file it hands back. A
 * type is worth deriving rather than defaulting to `application/octet-stream`
 * because it is what a browser's `<audio>` element consults before it will
 * play anything.
 */
export function voiceNoteMimeType(fileNameOrUri: string): string {
  switch (fileExtension(fileNameOrUri.split("?")[0]!)) {
    case "caf":
      return "audio/x-caf";
    case "m4a":
    case "aac":
      return "audio/mp4";
    case "mp3":
      return "audio/mpeg";
    case "ogg":
    case "oga":
    case "opus":
      return "audio/ogg";
    case "webm":
    case "weba":
      return "audio/webm";
    default:
      return "audio/wav";
  }
}

/**
 * Filename for a recording, from the moment it was made.
 *
 * The extension is what classifies the attachment downstream — `attachmentKind`
 * reads it before it reads the MIME type — so it has to come from the file the
 * recogniser actually wrote rather than from an assumption. The timestamp is
 * only there to make the name readable in a list; uniqueness comes from the
 * random segment in the storage key.
 */
export function voiceNoteFileName(at: Date, extension = "wav"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `voice-note-${stamp}.${extension}`;
}

/** True when a file name came from `voiceNoteFileName`. */
export function isVoiceNoteFileName(fileName: string): boolean {
  return /^voice-note-/.test(fileName);
}

/**
 * Elapsed time as `m:ss`, for the counter running under a live recording and
 * for the label on a finished one. Deliberately not `formatDuration` from
 * utils: that one is about how long a task takes ("1h 30m"), which is a
 * different unit and a different reading.
 */
export function formatRecordingTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
