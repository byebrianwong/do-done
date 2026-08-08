/**
 * Getting a finished recording out of the cache and onto a task.
 *
 * A voice note is an ordinary attachment — same table, same bucket, same RLS,
 * same cascade when the task is deleted. Giving recordings their own table
 * would have meant a second set of storage policies and a second thing for
 * `TasksApi.delete()` to remember to sweep, in exchange for nothing the
 * attachment row doesn't already carry.
 */

import { File } from "expo-file-system";
import { fileExtension, voiceNoteFileName, voiceNoteMimeType } from "@do-done/shared";
import type { AttachmentsApi } from "@do-done/api-client";
import type { TaskAttachment } from "@do-done/shared";
import type { VoiceRecording } from "./voice-capture";

/**
 * Name and type a recording from the file the recogniser actually wrote.
 *
 * Both are read off the URI rather than assumed, because the platforms differ
 * and neither announces which it chose: Android writes WAV, iOS may write CAF.
 * Getting the extension wrong would classify the app's own recording as an
 * anonymous download chip on both surfaces, since `attachmentKind` reads the
 * extension before the MIME type.
 */
export function describeRecording(
  audioUri: string,
  startedAt: number
): { fileName: string; mimeType: string } {
  const extension = fileExtension(audioUri.split("?")[0]!) || "wav";
  return {
    fileName: voiceNoteFileName(new Date(startedAt), extension),
    mimeType: voiceNoteMimeType(audioUri),
  };
}

/**
 * Upload a recording to a task, then delete the local copy.
 *
 * The cache file is deleted only after a successful upload. A failed one keeps
 * it — not so it can be retried automatically (nothing retries), but because
 * the alternative is destroying the only copy of something the user said in
 * response to a transient network error.
 */
export async function attachVoiceNote(
  api: AttachmentsApi,
  taskId: string,
  recording: Pick<VoiceRecording, "audioUri" | "startedAt">
): Promise<{ data: TaskAttachment | null; error: Error | null }> {
  const { audioUri, startedAt } = recording;
  if (!audioUri) {
    return { data: null, error: new Error("That recording produced no audio.") };
  }

  const { fileName, mimeType } = describeRecording(audioUri, startedAt);

  let bytes: Uint8Array;
  try {
    // `bytes()` rather than a base64 round-trip, for the same reason the file
    // picker uses it: Hermes has no `atob`, and base64 would inflate a
    // multi-minute recording by a third in memory.
    bytes = await new File(audioUri).bytes();
  } catch {
    return { data: null, error: new Error("Couldn't read the recording.") };
  }

  const result = await api.upload(taskId, {
    fileName,
    mimeType,
    size: bytes.length,
    body: bytes,
  });

  if (!result.error) {
    try {
      new File(audioUri).delete();
    } catch {
      // The bytes are safely uploaded; a leftover cache file is the OS's to
      // reclaim and not worth surfacing.
    }
  }

  return result;
}
