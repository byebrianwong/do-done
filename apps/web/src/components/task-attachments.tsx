"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ATTACHMENT_MAX_BYTES,
  attachmentKind,
  formatFileSize,
  isTextKind,
  type AttachmentKind,
  type TaskAttachment,
} from "@do-done/shared";
import { AttachmentsApi } from "@do-done/api-client";

// ─── Icons ─────────────────────────────────────────────────

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M10.5 5.5 6.2 9.8a1.5 1.5 0 0 0 2.1 2.1l4.6-4.6a3 3 0 0 0-4.2-4.2L4 7.8a4.5 4.5 0 0 0 6.4 6.4l3.1-3.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M9.2 1.8H4.5a1.2 1.2 0 0 0-1.2 1.2v10a1.2 1.2 0 0 0 1.2 1.2h7a1.2 1.2 0 0 0 1.2-1.2V5.3L9.2 1.8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M9 2v3.5h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Markdown rendering ────────────────────────────────────

/**
 * Tailwind has no typographic defaults, and the app doesn't ship
 * `@tailwindcss/typography`, so rendered Markdown would otherwise come out as
 * one undifferentiated run of text — every heading the same size as the body.
 * These map react-markdown's elements onto the modal's own type scale.
 *
 * `react-markdown` does not parse raw HTML unless `rehype-raw` is added, which
 * it deliberately is not: attachment content is untrusted, and an uploaded .md
 * carrying `<img onerror=…>` must stay inert text.
 */
const MARKDOWN_COMPONENTS = {
  h1: (p: object) => (
    <h1 className="mb-1.5 mt-3 text-[15px] font-semibold text-neutral-900 first:mt-0 dark:text-neutral-100" {...p} />
  ),
  h2: (p: object) => (
    <h2 className="mb-1.5 mt-3 text-[14px] font-semibold text-neutral-900 first:mt-0 dark:text-neutral-100" {...p} />
  ),
  h3: (p: object) => (
    <h3 className="mb-1 mt-2.5 text-[13px] font-semibold text-neutral-800 first:mt-0 dark:text-neutral-200" {...p} />
  ),
  h4: (p: object) => (
    <h4 className="mb-1 mt-2.5 text-[13px] font-semibold text-neutral-700 first:mt-0 dark:text-neutral-300" {...p} />
  ),
  p: (p: object) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
  ul: (p: object) => <ul className="my-1.5 list-disc space-y-0.5 pl-5" {...p} />,
  ol: (p: object) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5" {...p} />
  ),
  li: (p: object) => <li className="pl-0.5" {...p} />,
  a: (p: object) => (
    <a
      className="text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-500 dark:text-indigo-400"
      target="_blank"
      // Untrusted destination: deny it a handle on this window.
      rel="noopener noreferrer nofollow"
      {...p}
    />
  ),
  code: (p: object) => (
    <code
      className="rounded bg-neutral-200/70 px-1 py-px font-mono text-[11.5px] dark:bg-neutral-800"
      {...p}
    />
  ),
  pre: (p: object) => (
    <pre
      className="my-2 overflow-x-auto rounded-md bg-neutral-100 p-2.5 font-mono text-[11.5px] leading-relaxed dark:bg-neutral-900 [&_code]:bg-transparent [&_code]:p-0"
      {...p}
    />
  ),
  blockquote: (p: object) => (
    <blockquote
      className="my-2 border-l-2 border-neutral-300 pl-3 italic text-neutral-500 dark:border-neutral-700"
      {...p}
    />
  ),
  hr: () => (
    <hr className="my-3 border-neutral-200 dark:border-neutral-800" />
  ),
  table: (p: object) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]" {...p} />
    </div>
  ),
  th: (p: object) => (
    <th
      className="border border-neutral-200 bg-neutral-100 px-2 py-1 text-left font-semibold dark:border-neutral-800 dark:bg-neutral-900"
      {...p}
    />
  ),
  td: (p: object) => (
    <td
      className="border border-neutral-200 px-2 py-1 dark:border-neutral-800"
      {...p}
    />
  ),
  img: ({ alt }: { alt?: string }) => (
    // A relative image path inside an attached .md has nothing to resolve
    // against, and an absolute one is a third-party request the user didn't
    // ask for. Render the alt text instead of a broken frame.
    <span className="text-neutral-400">🖼 {alt || "image"}</span>
  ),
};

// ─── Text preview (markdown + plain) ───────────────────────

/**
 * Preview height before the fold. Enough to show a document's shape — title,
 * first paragraph, the start of a list — without a long file pushing the rest
 * of the editor off screen.
 */
const PREVIEW_COLLAPSED_PX = 168;

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
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

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

  // "Show more" only appears when there is more — measured after render,
  // because whether a file overflows depends on how it lays out, not on its
  // byte count.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || text === null) return;
    setOverflows(el.scrollHeight > PREVIEW_COLLAPSED_PX + 8);
  }, [text]);

  if (error) {
    return <p className="px-3 py-2 text-[12px] text-neutral-400">{error}</p>;
  }
  if (text === null) {
    return <p className="px-3 py-2 text-[12px] text-neutral-400">Loading…</p>;
  }

  return (
    <div className="relative">
      <div
        ref={bodyRef}
        style={expanded ? undefined : { maxHeight: PREVIEW_COLLAPSED_PX }}
        className="overflow-hidden px-3 py-2.5 text-[12.5px] leading-relaxed text-neutral-700 dark:text-neutral-300"
      >
        {kind === "markdown" ? (
          <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {text}
          </Markdown>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed">
            {text}
          </pre>
        )}
      </div>
      {overflows ? (
        <>
          {/* Fades the clipped edge so it reads as "continues" rather than
              "ends abruptly". Pointer-events off so it can't eat the click. */}
          {!expanded ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-8 h-8 bg-gradient-to-t from-white to-transparent dark:from-neutral-950" />
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="w-full border-t border-neutral-100 px-3 py-1.5 text-left text-[11px] font-medium text-indigo-600 transition-colors hover:bg-neutral-50 dark:border-neutral-900 dark:text-indigo-400 dark:hover:bg-neutral-900"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </>
      ) : null}
    </div>
  );
}

// ─── Lightbox ──────────────────────────────────────────────

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    // Capture phase: the task modal also listens for Escape, and without this
    // the first press would close the whole editor out from under the image.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/80 p-8 backdrop-blur-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}

// ─── One attachment ────────────────────────────────────────

function AttachmentCard({
  attachment,
  url,
  api,
  onRemove,
  onExpandImage,
}: {
  attachment: TaskAttachment;
  /** Signed URL, or undefined while signing (or if signing failed). */
  url: string | undefined;
  api: AttachmentsApi;
  onRemove: () => void;
  onExpandImage: (src: string, alt: string) => void;
}) {
  const kind = attachmentKind(attachment.mime_type, attachment.file_name);
  const [removing, setRemoving] = useState(false);

  const handleDownload = async () => {
    const { data } = await api.downloadUrl(attachment);
    if (data) window.open(data, "_blank", "noopener,noreferrer");
  };

  const header = (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="shrink-0 text-neutral-400">
        <DocumentIcon className="h-3.5 w-3.5" />
      </span>
      <button
        type="button"
        onClick={() => void handleDownload()}
        className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-neutral-700 hover:text-indigo-600 dark:text-neutral-300 dark:hover:text-indigo-400"
      >
        {attachment.file_name}
      </button>
      <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">
        {formatFileSize(attachment.size_bytes)}
      </span>
      <RemoveButton
        label={`Remove ${attachment.file_name}`}
        busy={removing}
        onClick={() => {
          setRemoving(true);
          onRemove();
        }}
      />
    </div>
  );

  if (kind === "image") {
    return (
      <div className="group relative overflow-hidden rounded-lg border border-neutral-100 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-900/40">
        {url ? (
          <button
            type="button"
            onClick={() => onExpandImage(url, attachment.file_name)}
            className="block w-full"
            aria-label={`Open ${attachment.file_name} full size`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={attachment.file_name}
              // `max-h` rather than a fixed aspect box: a screenshot and a
              // portrait photo both read correctly, and neither is cropped
              // through the part the user attached it for.
              className="max-h-64 w-full bg-neutral-100 object-contain dark:bg-neutral-900"
            />
          </button>
        ) : (
          <div className="flex h-32 items-center justify-center text-[12px] text-neutral-400">
            Loading…
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-neutral-100 px-3 py-1.5 dark:border-neutral-900">
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-neutral-500">
            {attachment.file_name}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">
            {formatFileSize(attachment.size_bytes)}
          </span>
          <RemoveButton
            label={`Remove ${attachment.file_name}`}
            busy={removing}
            onClick={() => {
              setRemoving(true);
              onRemove();
            }}
          />
        </div>
      </div>
    );
  }

  if (isTextKind(kind)) {
    return (
      <div className="overflow-hidden rounded-lg border border-neutral-100 bg-white dark:border-neutral-900 dark:bg-neutral-950">
        <div className="border-b border-neutral-100 dark:border-neutral-900">
          {header}
        </div>
        <TextPreview attachment={attachment} kind={kind} api={api} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50/60 dark:border-neutral-900 dark:bg-neutral-900/40">
      {header}
    </div>
  );
}

function RemoveButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className="shrink-0 rounded p-0.5 text-[13px] leading-none text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-red-500 disabled:opacity-40 dark:hover:bg-neutral-800"
    >
      ×
    </button>
  );
}

// ─── Section ───────────────────────────────────────────────

/** A file mid-upload — shown as a placeholder row so the wait isn't silent. */
interface PendingUpload {
  key: string;
  fileName: string;
  size: number;
}

export interface AttachmentsSectionProps {
  taskId: string;
  /** Constructed by the caller, already bound to the signed-in user. */
  api: AttachmentsApi;
}

/**
 * The attachments block in the task editor: upload, preview, remove.
 *
 * Loads its own data rather than taking it as a prop, the way SubtasksSection
 * does — the editor's task object comes from a list query that has no reason
 * to carry attachment rows, and a task with no attachments (the common case)
 * should cost the lists nothing.
 */
export function AttachmentsSection({ taskId, api }: AttachmentsSectionProps) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Drag events fire per element, so entering a child fires dragleave for the
  // parent. Counting enters/leaves is what keeps the highlight from flickering
  // as the pointer crosses the zone's own children.
  const dragDepth = useRef(0);

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

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);

      const tooBig = files.filter((f) => f.size > ATTACHMENT_MAX_BYTES);
      const usable = files.filter((f) => f.size <= ATTACHMENT_MAX_BYTES);
      if (tooBig.length > 0) {
        setError(
          `${tooBig.map((f) => f.name).join(", ")} — over the ${formatFileSize(
            ATTACHMENT_MAX_BYTES
          )} limit.`
        );
      }

      const marks = usable.map((f, i) => ({
        key: `${Date.now()}-${i}-${f.name}`,
        fileName: f.name,
        size: f.size,
      }));
      setPending((prev) => [...prev, ...marks]);

      // Sequential, not Promise.all: dropping ten screenshots at once would
      // otherwise open ten concurrent uploads and starve the modal's own
      // autosave requests behind the browser's per-host connection cap.
      for (let i = 0; i < usable.length; i++) {
        const file = usable[i]!;
        const mark = marks[i]!;
        const { data, error: err } = await api.upload(taskId, {
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          body: file,
        });
        setPending((prev) => prev.filter((p) => p.key !== mark.key));
        if (err || !data) {
          setError(err?.message ?? `Couldn't attach ${file.name}.`);
          continue;
        }
        setAttachments((prev) => [...prev, data]);
        if (attachmentKind(data.mime_type, data.file_name) === "image") {
          const { data: signed } = await api.signedUrls([data]);
          setUrls((prev) => new Map([...prev, ...signed]));
        }
      }
    },
    [api, taskId]
  );

  const handleRemove = useCallback(
    async (attachment: TaskAttachment) => {
      // Optimistic: the row goes now, and comes back if the delete failed.
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
    <div>
      <div className="mb-2 flex items-baseline gap-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
          Attachments
        </span>
        {count > 0 ? (
          <span className="text-[11px] font-medium text-neutral-500">{count}</span>
        ) : null}
      </div>

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void addFiles(Array.from(e.dataTransfer.files));
        }}
        className={`space-y-2 rounded-lg border p-2 transition-colors ${
          dragging
            ? "border-indigo-300 bg-indigo-50/60 dark:border-indigo-700 dark:bg-indigo-950/30"
            : "border-neutral-100 bg-neutral-50/60 dark:border-neutral-900 dark:bg-neutral-900/40"
        }`}
      >
        {attachments.map((a) => (
          <AttachmentCard
            key={a.id}
            attachment={a}
            url={urls.get(a.id)}
            api={api}
            onRemove={() => void handleRemove(a)}
            onExpandImage={(src, alt) => setLightbox({ src, alt })}
          />
        ))}

        {pending.map((p) => (
          <div
            key={p.key}
            className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-200 px-3 py-2 dark:border-neutral-800"
          >
            <span className="shrink-0 animate-pulse text-neutral-400">
              <DocumentIcon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-500">
              {p.fileName}
            </span>
            <span className="shrink-0 text-[11px] text-neutral-400">
              Uploading…
            </span>
          </div>
        ))}

        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            // Reset so re-picking the same file fires change again.
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-neutral-500 transition-colors hover:bg-white hover:text-indigo-600 dark:hover:bg-neutral-900 dark:hover:text-indigo-400"
        >
          <PaperclipIcon className="h-3.5 w-3.5 shrink-0" />
          {count > 0 ? "Add another file" : "Attach a file"}
          <span className="ml-auto text-[11px] font-normal text-neutral-400">
            or drop one here
          </span>
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-1.5 text-[11.5px] text-red-500">
          {error}
        </p>
      ) : null}

      {lightbox ? (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}
