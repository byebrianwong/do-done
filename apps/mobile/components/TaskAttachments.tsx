import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import {
  ATTACHMENT_MAX_BYTES,
  attachmentKind,
  formatFileSize,
  formatRecordingTime,
  isTextKind,
  isVoiceNoteFileName,
  type AttachmentKind,
  type TaskAttachment,
} from "@do-done/shared";
import type { AttachmentsApi } from "@do-done/api-client";
import { useVoiceCapture, type VoiceRecording } from "@/lib/voice-capture";
import { attachVoiceNote } from "@/lib/voice-note";
import { MarkdownView } from "./MarkdownView";
import VoiceRecorder from "./VoiceRecorder";

/**
 * Attachments in the mobile task editor.
 *
 * Two ways in, because Android and iOS split them: "Photo" goes to the image
 * library (which returns assets, not files) and "File" to the document picker.
 * A single entry point would mean picking one of the two and making the other
 * impossible.
 *
 * Nothing here holds a TanStack Query hook — the section loads its own rows
 * the way SubtasksSection does, so it can also be dropped into a surface with
 * no QueryClientProvider.
 */

/** How tall a text preview grows before it folds. */
const PREVIEW_MAX_HEIGHT = 220;

/**
 * Kinds that render from the bytes themselves and so need a signed URL up
 * front. Text kinds are excluded deliberately — they fetch their own content
 * through `api.fetchText`, and signing them here would open a second request
 * for every one of them.
 */
function needsSignedUrl(attachment: TaskAttachment): boolean {
  const kind = attachmentKind(attachment.mime_type, attachment.file_name);
  return kind === "image" || kind === "audio";
}

interface PendingUpload {
  key: string;
  fileName: string;
}

/** A file the user picked, normalized across the two pickers. */
interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

function TextPreview({
  attachment,
  kind,
  api,
}: {
  attachment: TaskAttachment;
  kind: AttachmentKind;
  api: AttachmentsApi;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await api.fetchText(attachment);
      if (cancelled) return;
      if (err) setError(err.message);
      else setText(data ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [api, attachment]);

  if (error) return <Text style={styles.previewNote}>{error}</Text>;
  if (text === null) return <Text style={styles.previewNote}>Loading…</Text>;

  return (
    <View>
      <View
        style={[styles.previewBody, expanded ? null : { maxHeight: PREVIEW_MAX_HEIGHT }]}
      >
        {kind === "markdown" ? (
          <MarkdownView source={text} />
        ) : (
          <Text style={styles.plainText}>{text}</Text>
        )}
      </View>
      <Pressable onPress={() => setExpanded((e) => !e)} style={styles.moreRow}>
        <Text style={styles.moreText}>{expanded ? "Show less" : "Show more"}</Text>
      </Pressable>
    </View>
  );
}

/**
 * Playback for an audio attachment — in practice, for a voice note.
 *
 * It plays in place rather than handing off to the system player, because a
 * recording made in the app is the one attachment the user is most likely to
 * want to check *against* the transcript sitting a few pixels above it.
 * Bouncing out to another app to hear it would break exactly that comparison.
 *
 * The source is a signed URL with an hour on it, so the player is given the
 * URL the parent already fetched rather than fetching its own.
 */
function AudioPlayerCard({ url }: { url: string | undefined }) {
  // `useAudioPlayer` accepts null and simply stays unloaded, which is what
  // holds the row's shape steady while the signed URL is still in flight.
  const player = useAudioPlayer(url ? { uri: url } : null);
  const status = useAudioPlayerStatus(player);

  const durationMs = (status.duration || 0) * 1000;
  const positionMs = (status.currentTime || 0) * 1000;
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    // A finished player sits at the end, so playing again would return
    // instantly with nothing audible. Rewinding first is what makes the
    // second tap behave like the first.
    if (status.didJustFinish || (durationMs > 0 && positionMs >= durationMs)) {
      player.seekTo(0);
    }
    player.play();
  };

  return (
    <View style={styles.audioRow}>
      <Pressable
        onPress={toggle}
        disabled={!status.isLoaded}
        hitSlop={8}
        accessibilityLabel={status.playing ? "Pause" : "Play"}
        style={[styles.playButton, !status.isLoaded && styles.playButtonMuted]}
      >
        {status.isLoaded ? (
          <Text style={styles.playGlyph}>{status.playing ? "❚❚" : "▶"}</Text>
        ) : (
          <ActivityIndicator size="small" color="#fff" />
        )}
      </Pressable>

      <View style={styles.audioTrack}>
        <View style={[styles.audioFill, { width: `${progress * 100}%` }]} />
      </View>

      <Text style={styles.audioTime}>
        {/* Counts up while playing and shows the total at rest, which is the
            reading that answers "how long is this?" before you commit to it. */}
        {formatRecordingTime(status.playing || positionMs > 0 ? positionMs : durationMs)}
      </Text>
    </View>
  );
}

function AttachmentCard({
  attachment,
  url,
  api,
  onRemove,
  onExpandImage,
}: {
  attachment: TaskAttachment;
  url: string | undefined;
  api: AttachmentsApi;
  onRemove: () => void;
  onExpandImage: (src: string) => void;
}) {
  const kind = attachmentKind(attachment.mime_type, attachment.file_name);

  const openExternally = async () => {
    const { data } = await api.downloadUrl(attachment);
    if (data) void Linking.openURL(data);
  };

  const meta = (
    <View style={styles.metaRow}>
      <Text style={styles.fileName} numberOfLines={1}>
        {/* A recording's stored name is a timestamp, which tells the reader
            nothing they can't see from the row's position. Say what it is. */}
        {kind === "audio" && isVoiceNoteFileName(attachment.file_name)
          ? "🎙  Voice note"
          : attachment.file_name}
      </Text>
      <Text style={styles.fileSize}>{formatFileSize(attachment.size_bytes)}</Text>
      <Pressable
        onPress={onRemove}
        hitSlop={10}
        accessibilityLabel={`Remove ${attachment.file_name}`}
      >
        <Text style={styles.removeGlyph}>×</Text>
      </Pressable>
    </View>
  );

  if (kind === "image") {
    return (
      <View style={styles.card}>
        {url ? (
          <Pressable
            onPress={() => onExpandImage(url)}
            accessibilityLabel={`Open ${attachment.file_name} full size`}
          >
            <Image
              source={{ uri: url }}
              style={styles.image}
              // `contain` rather than `cover`: a screenshot cropped through
              // the part the user attached it for is worse than letterboxing.
              resizeMode="contain"
            />
          </Pressable>
        ) : (
          <View style={styles.imagePlaceholder}>
            <ActivityIndicator size="small" color="#9ca3af" />
          </View>
        )}
        {meta}
      </View>
    );
  }

  if (kind === "audio") {
    return (
      <View style={styles.card}>
        {meta}
        <AudioPlayerCard url={url} />
      </View>
    );
  }

  if (isTextKind(kind)) {
    return (
      <View style={styles.card}>
        {meta}
        <TextPreview attachment={attachment} kind={kind} api={api} />
      </View>
    );
  }

  return (
    <Pressable style={styles.card} onPress={() => void openExternally()}>
      {meta}
    </Pressable>
  );
}

function AttachmentsSectionImpl({
  taskId,
  api,
  onTranscript,
}: {
  taskId: string;
  /** Constructed by the caller, already bound to the signed-in user. */
  api: AttachmentsApi;
  /**
   * Where a recording's words go. The audio lands here as an attachment, but
   * the text belongs to the task's description, which this section doesn't
   * own — so it hands the transcript up. Omit it and the mic still records;
   * only the transcript is dropped.
   *
   * Must be stable, like every other prop here: the section is memoized
   * against the editor's per-keystroke re-render.
   */
  onTranscript?: (transcript: string) => void;
}) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await api.list(taskId);
      if (cancelled) return;
      setAttachments(data);
      const { data: signed } = await api.signedUrls(data.filter(needsSignedUrl));
      if (!cancelled) setUrls(signed);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, taskId]);

  const uploadPicked = useCallback(
    async (files: PickedFile[]) => {
      if (files.length === 0) return;
      setError(null);

      for (const file of files) {
        if (file.size > ATTACHMENT_MAX_BYTES) {
          setError(
            `${file.name} is over the ${formatFileSize(ATTACHMENT_MAX_BYTES)} limit.`
          );
          continue;
        }
        const mark = { key: `${file.uri}-${file.name}`, fileName: file.name };
        setPending((prev) => [...prev, mark]);
        try {
          // `bytes()` rather than a base64 round-trip: Hermes has no `atob`,
          // and base64 would inflate a 10 MB file by a third in memory on a
          // device that may not have it to spare.
          const body = await new File(file.uri).bytes();
          const { data, error: err } = await api.upload(taskId, {
            fileName: file.name,
            mimeType: file.mimeType,
            size: file.size,
            body,
          });
          if (err || !data) {
            setError(err?.message ?? `Couldn't attach ${file.name}.`);
          } else {
            setAttachments((prev) => [...prev, data]);
            if (needsSignedUrl(data)) {
              const { data: signed } = await api.signedUrls([data]);
              setUrls((prev) => new Map([...prev, ...signed]));
            }
          }
        } catch {
          setError(`Couldn't read ${file.name}.`);
        } finally {
          setPending((prev) => prev.filter((p) => p.key !== mark.key));
        }
      }
    },
    [api, taskId]
  );

  const pickPhoto = useCallback(async () => {
    // The permission prompt is deliberately here and nowhere else: a user who
    // never attaches a photo is never asked for their library.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("DoDone needs photo access to attach an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled) return;
    await uploadPicked(
      result.assets.map((a, i) => ({
        uri: a.uri,
        // The library doesn't always surface a filename (iOS assets often have
        // none), and the extension is what classifies the file downstream.
        name: a.fileName ?? `photo-${Date.now()}-${i}.jpg`,
        mimeType: a.mimeType ?? "image/jpeg",
        size: a.fileSize ?? 0,
      }))
    );
  }, [uploadPicked]);

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: true,
      // Without this the picker can hand back a URI into a provider that has
      // already released it by the time the upload reads it.
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    await uploadPicked(
      result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        mimeType: a.mimeType ?? "application/octet-stream",
        size: a.size ?? 0,
      }))
    );
  }, [uploadPicked]);

  // Unlike quick-add, the task already exists here, so a recording can be
  // filed the moment it stops rather than waiting on a submit.
  const onRecordingDone = useCallback(
    async (recording: VoiceRecording) => {
      setRecorderOpen(false);
      // The words go up first: they're what the user will see land in the
      // description, and they shouldn't have to wait on an upload for it.
      if (recording.transcript) onTranscriptRef.current?.(recording.transcript);
      if (!recording.audioUri) return;

      setSavingNote(true);
      const { data, error: err } = await attachVoiceNote(api, taskId, recording);
      setSavingNote(false);

      if (err || !data) {
        setError(err?.message ?? "Couldn't attach that recording.");
        return;
      }
      setAttachments((prev) => [...prev, data]);
      const { data: signed } = await api.signedUrls([data]);
      setUrls((prev) => new Map([...prev, ...signed]));
    },
    [api, taskId]
  );

  // Read through a ref so `onRecordingDone` — and with it the native event
  // subscriptions inside `useVoiceCapture` — survives a parent that passes a
  // fresh closure.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const voice = useVoiceCapture({ onDone: (r) => void onRecordingDone(r) });

  const startRecording = useCallback(async () => {
    setError(null);
    // Only open the card once the microphone is actually running: a refused
    // permission should leave the section as it was, not showing a recorder
    // that will never hear anything.
    if (await voice.start()) setRecorderOpen(true);
  }, [voice]);

  const handleRemove = useCallback(
    async (attachment: TaskAttachment) => {
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
      const { error: err } = await api.remove(attachment);
      if (err) {
        setError(`Couldn't remove ${attachment.file_name}.`);
        setAttachments((prev) =>
          [...prev, attachment].sort((a, b) =>
            a.created_at.localeCompare(b.created_at)
          )
        );
      }
    },
    [api]
  );

  const count = attachments.length + pending.length;

  return (
    <View style={{ marginTop: 18 }}>
      <View style={styles.rowHead}>
        <Text style={styles.sectionLabel}>Attachments</Text>
        {count > 0 ? <Text style={styles.sectionCount}>{count}</Text> : null}
      </View>

      <View style={styles.container}>
        {attachments.map((a) => (
          <AttachmentCard
            key={a.id}
            attachment={a}
            url={urls.get(a.id)}
            api={api}
            onRemove={() => void handleRemove(a)}
            onExpandImage={setLightbox}
          />
        ))}

        {pending.map((p) => (
          <View key={p.key} style={styles.pendingRow}>
            <ActivityIndicator size="small" color="#9ca3af" />
            <Text style={styles.pendingName} numberOfLines={1}>
              {p.fileName}
            </Text>
            <Text style={styles.fileSize}>Uploading…</Text>
          </View>
        ))}

        {savingNote ? (
          <View style={styles.pendingRow}>
            <ActivityIndicator size="small" color="#9ca3af" />
            <Text style={styles.pendingName}>Voice note</Text>
            <Text style={styles.fileSize}>Uploading…</Text>
          </View>
        ) : null}

        {recorderOpen ? (
          <VoiceRecorder voice={voice} onCancel={() => {
            voice.cancel();
            setRecorderOpen(false);
          }} />
        ) : null}

        <View style={styles.addRow}>
          {voice.supported ? (
            <Pressable
              style={styles.addButton}
              onPress={() => void startRecording()}
              disabled={recorderOpen}
            >
              <Text style={styles.addButtonText}>🎙  Record</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.addButton} onPress={() => void pickPhoto()}>
            <Text style={styles.addButtonText}>🖼  Photo</Text>
          </Pressable>
          <Pressable style={styles.addButton} onPress={() => void pickDocument()}>
            <Text style={styles.addButtonText}>📎  File</Text>
          </Pressable>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal
        visible={lightbox !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightbox(null)}
      >
        <Pressable style={styles.lightbox} onPress={() => setLightbox(null)}>
          {lightbox ? (
            <Image
              source={{ uri: lightbox }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * Memoized for the same reason `SubtasksSection` is: both props are stable
 * (an id and a memoized API), so the section sits out the re-render every
 * keystroke in the title field causes.
 */
export const AttachmentsSection = React.memo(AttachmentsSectionImpl);

const styles = StyleSheet.create({
  rowHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  sectionCount: { fontSize: 12, fontWeight: "600", color: "#6b7280" },

  container: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    padding: 8,
    gap: 8,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    overflow: "hidden",
  },
  image: { width: "100%", height: 200, backgroundColor: "#f3f4f6" },
  imagePlaceholder: {
    width: "100%",
    height: 120,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  fileName: { flex: 1, fontSize: 13, fontWeight: "500", color: "#374151" },
  fileSize: { fontSize: 11, color: "#9ca3af" },
  removeGlyph: { fontSize: 18, lineHeight: 20, color: "#d1d5db" },

  previewBody: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    overflow: "hidden",
  },
  previewNote: { paddingHorizontal: 10, paddingBottom: 8, fontSize: 12, color: "#9ca3af" },
  plainText: {
    fontFamily: "monospace",
    fontSize: 11.5,
    lineHeight: 17,
    color: "#374151",
  },
  moreRow: {
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  moreText: { fontSize: 11.5, fontWeight: "600", color: "#4f46e5" },

  audioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  playButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
  },
  playButtonMuted: { backgroundColor: "#c7d2fe" },
  // The glyphs are text, not icons: ▶ and ❚❚ need no font the app would
  // otherwise have to ship, and both sit on the baseline the same way.
  playGlyph: { color: "#fff", fontSize: 12, lineHeight: 14 },
  audioTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e5e7eb",
    overflow: "hidden",
  },
  audioFill: { height: 4, borderRadius: 2, backgroundColor: "#6366f1" },
  audioTime: {
    fontSize: 12,
    color: "#6b7280",
    fontVariant: ["tabular-nums"],
    minWidth: 34,
    textAlign: "right",
  },

  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#e5e7eb",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  pendingName: { flex: 1, fontSize: 13, color: "#6b7280" },

  addRow: { flexDirection: "row", gap: 8 },
  addButton: {
    flex: 1,
    alignItems: "center",
    borderRadius: 8,
    paddingVertical: 9,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  addButtonText: { fontSize: 12.5, fontWeight: "600", color: "#6b7280" },

  error: { marginTop: 6, fontSize: 12, color: "#ef4444" },

  lightbox: {
    flex: 1,
    backgroundColor: "rgba(10,10,10,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  lightboxImage: { width: "100%", height: "100%" },
});
