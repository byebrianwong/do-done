import React, { useCallback, useEffect, useState } from "react";
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
import {
  ATTACHMENT_MAX_BYTES,
  attachmentKind,
  formatFileSize,
  isTextKind,
  type AttachmentKind,
  type TaskAttachment,
} from "@do-done/shared";
import type { AttachmentsApi } from "@do-done/api-client";
import { MarkdownView } from "./MarkdownView";

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
        {attachment.file_name}
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

export function AttachmentsSection({
  taskId,
  api,
}: {
  taskId: string;
  /** Constructed by the caller, already bound to the signed-in user. */
  api: AttachmentsApi;
}) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await api.list(taskId);
      if (cancelled) return;
      setAttachments(data);
      const { data: signed } = await api.signedUrls(
        data.filter((a) => attachmentKind(a.mime_type, a.file_name) === "image")
      );
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
            if (attachmentKind(data.mime_type, data.file_name) === "image") {
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

        <View style={styles.addRow}>
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
