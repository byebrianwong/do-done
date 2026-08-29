/**
 * Attachment classification — what an attached file *is*, decided once and
 * shared by every surface that renders one.
 *
 * The rules are here rather than in either app because "is this an image?" has
 * to give the same answer on web (where it decides between an <img> and a
 * download chip) and on mobile (where it decides between an <Image> and a row).
 * A file that previewed on one and downloaded on the other would look like a
 * bug in whichever one the user tried second.
 */

/**
 * Hard ceiling on a single attachment, mirrored by `file_size_limit` on the
 * Storage bucket. The client check exists to fail fast with a sentence the user
 * can act on; the bucket's is what actually holds, since a hand-rolled request
 * never runs this code.
 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** How long a signed attachment URL stays valid. */
export const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Ceiling on how much of a text attachment gets pulled down for the inline
 * preview. A .md file is usually a couple of KB; a 10 MB log pasted in as .txt
 * would otherwise be fetched and parsed in full just to render a card nobody
 * asked to expand.
 */
export const ATTACHMENT_TEXT_PREVIEW_MAX_BYTES = 256 * 1024;

/**
 * How an attachment renders.
 *
 * - `image`    — shown inline as a picture.
 * - `audio`    — played inline; this is what a voice note comes back as.
 * - `markdown` — parsed and rendered as formatted text.
 * - `text`     — shown inline as monospaced plain text.
 * - `pdf`      — offered as a download; neither app embeds a PDF viewer.
 * - `file`     — anything else: a name, a size, and a download.
 */
export type AttachmentKind =
  | "image"
  | "audio"
  | "markdown"
  | "text"
  | "pdf"
  | "file";

/** Extensions we treat as Markdown regardless of what the OS claimed. */
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);

/**
 * Extensions that are plain text but that browsers and Android both like to
 * label `application/octet-stream`. Listing them by extension is what keeps a
 * .csv from arriving as an unpreviewable blob.
 */
const TEXT_EXTENSIONS = new Set([
  "txt",
  "text",
  "log",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "css",
  "html",
  "xml",
  "sql",
  "sh",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "swift",
  "kt",
]);

/**
 * Extensions that play as audio.
 *
 * `wav` is first because it is what the speech recogniser persists
 * on both platforms, so every voice note in the app arrives as one — and both
 * Android's document picker and iOS hand a .wav over as
 * `application/octet-stream` often enough that the MIME fallback alone would
 * render the app's own recordings as anonymous download chips.
 */
const AUDIO_EXTENSIONS = new Set([
  "wav",
  "m4a",
  "mp3",
  "aac",
  "caf",
  "ogg",
  "oga",
  "opus",
  "flac",
  "amr",
  "3gp",
  "3gpp",
  "weba",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "heic",
  "heif",
]);

/** Lowercased extension without the dot, or "" when there isn't one. */
export function fileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  // `dot < 1` also rejects dotfiles (".env"), whose leading dot names the file
  // rather than introducing a type.
  if (dot < 1 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Classify by extension first, MIME type second.
 *
 * That order is deliberate. `text/markdown` is not in the IANA registry that
 * most platforms ship, so a .md file arrives as `text/plain` from a browser,
 * `application/octet-stream` from Android's document picker, and occasionally
 * with an empty type from a drag-and-drop. The extension is the only signal
 * that survives all three — the MIME type is the fallback, for the case where
 * the user renamed the file to nothing in particular.
 */
export function attachmentKind(
  mimeType: string | null | undefined,
  fileName: string
): AttachmentKind {
  const ext = fileExtension(fileName);
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(ext)) return "text";

  const mime = (mimeType ?? "").toLowerCase().split(";")[0]!.trim();
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  // SVG is an image that is also a script host. Rendering one inline would run
  // whatever <script> the file carries, in the app's own origin — so it stays a
  // download, and is excluded from IMAGE_EXTENSIONS above for the same reason.
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "image";
  // Catches the containers not worth naming by extension — `audio/webm` above
  // all, since a bare .webm could equally be video and the type is the only
  // thing that says which.
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  return "file";
}

/** True when the kind renders from the file's own text content. */
export function isTextKind(kind: AttachmentKind): boolean {
  return kind === "markdown" || kind === "text";
}

/**
 * Human-readable size. Deliberately coarse — one decimal past MB, none below —
 * because the number is a glance-level cue about whether a download is going to
 * take a moment, not an accounting figure.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/**
 * Build the Storage object key for a new attachment.
 *
 * The leading `userId` segment is what Storage RLS authorizes on — policies see
 * the path and nothing else, so the owner has to be in it. The random `id`
 * makes the key unguessable and lets the same file be attached twice without
 * either upload clobbering the other; the original name is kept in the DB row
 * and re-applied at download time.
 */
export function attachmentStoragePath(
  userId: string,
  taskId: string,
  id: string,
  fileName: string
): string {
  const ext = fileExtension(fileName);
  return `${userId}/${taskId}/${id}${ext ? `.${ext}` : ""}`;
}
