import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskAttachment } from "@do-done/shared";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_SIGNED_URL_TTL_SECONDS,
  ATTACHMENT_TEXT_PREVIEW_MAX_BYTES,
  attachmentStoragePath,
} from "@do-done/shared";

/** The Storage bucket holding attachment bytes. Private; see the migration. */
export const ATTACHMENTS_BUCKET = "task-attachments";

/** One file, ready to upload. */
export interface AttachmentUpload {
  fileName: string;
  /** As reported by the picker. May be wrong or empty — `attachmentKind` copes. */
  mimeType: string;
  size: number;
  /**
   * The bytes. Web hands over the `File` straight from the input or drop
   * event; React Native has no usable `File`, so it passes the `Uint8Array`
   * that `expo-file-system`'s `File(uri).bytes()` returns.
   */
  body: Blob | ArrayBuffer | Uint8Array;
}

/**
 * Random object-key segment.
 *
 * `crypto.randomUUID` is there on web and absent on Hermes unless a polyfill
 * was installed, so this degrades rather than throwing on a phone. The weaker
 * fallback is acceptable here because the key is not a capability: the bucket
 * is private and every policy on it is scoped to the owner's user id, so an
 * unguessable key is defence in depth rather than the thing doing the work.
 */
function randomId(): string {
  // Typed structurally rather than as `Crypto`: this package compiles without
  // the DOM lib, since it also runs on the MCP server and on Hermes.
  const c = (
    globalThis as {
      crypto?: {
        randomUUID?: () => string;
        getRandomValues?: (a: Uint8Array) => Uint8Array;
      };
    }
  ).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b: number) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** A file exceeding the ceiling, rejected before a byte goes over the wire. */
export class AttachmentTooLargeError extends Error {
  constructor(public readonly size: number) {
    super(
      `That file is too large to attach (limit ${Math.round(
        ATTACHMENT_MAX_BYTES / (1024 * 1024)
      )} MB).`
    );
    this.name = "AttachmentTooLargeError";
  }
}

export class AttachmentsApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  /**
   * The owner's id, which the Storage key must start with. Falls back to the
   * session when the caller didn't supply one — an upload cannot proceed
   * without it, since Storage RLS authorizes on that leading path segment.
   */
  private async ownerId(): Promise<string | null> {
    if (this.userId) return this.userId;
    const { data } = await this.supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  }

  async list(
    taskId: string
  ): Promise<{ data: TaskAttachment[]; error: Error | null }> {
    let query = this.supabase
      .from("task_attachments")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    return {
      data: (data as TaskAttachment[]) ?? [],
      error: error as Error | null,
    };
  }

  /**
   * Upload bytes, then record the metadata row.
   *
   * That order matters: a metadata row pointing at bytes that never arrived
   * renders as a permanently broken attachment, whereas bytes with no row are
   * merely invisible. So if the insert fails, the object is removed again —
   * the failure leaves nothing behind either way.
   */
  async upload(
    taskId: string,
    file: AttachmentUpload
  ): Promise<{ data: TaskAttachment | null; error: Error | null }> {
    if (file.size > ATTACHMENT_MAX_BYTES) {
      return { data: null, error: new AttachmentTooLargeError(file.size) };
    }

    const userId = await this.ownerId();
    if (!userId) {
      return {
        data: null,
        error: new Error("Not signed in — can't attach a file."),
      };
    }

    const path = attachmentStoragePath(
      userId,
      taskId,
      randomId(),
      file.fileName
    );

    const { error: uploadError } = await this.supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, file.body, {
        contentType: file.mimeType || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) return { data: null, error: uploadError as Error };

    const { data, error } = await this.supabase
      .from("task_attachments")
      .insert({
        task_id: taskId,
        user_id: userId,
        storage_path: path,
        file_name: file.fileName,
        mime_type: file.mimeType || "application/octet-stream",
        size_bytes: file.size,
      })
      .select()
      .single();

    if (error) {
      await this.supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
      return { data: null, error: error as Error };
    }
    return { data: data as TaskAttachment, error: null };
  }

  /**
   * Delete an attachment, bytes first.
   *
   * The mirror of `upload`'s ordering, for the same reason: a row whose object
   * is gone is a broken attachment on screen, so the row is what survives a
   * partial failure and lets the user retry.
   */
  async remove(attachment: TaskAttachment): Promise<{ error: Error | null }> {
    const { error: storageError } = await this.supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove([attachment.storage_path]);
    if (storageError) return { error: storageError as Error };

    let query = this.supabase
      .from("task_attachments")
      .delete()
      .eq("id", attachment.id);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { error } = await query;
    return { error: error as Error | null };
  }

  /**
   * Remove every attachment belonging to these tasks.
   *
   * Called before a task row is deleted. The `task_attachments` FK cascades on
   * its own, but a cascade only reaches the metadata — the bytes in the bucket
   * have no foreign key to follow, and would be left paying rent forever with
   * nothing in the UI pointing at them.
   */
  async removeForTasks(taskIds: string[]): Promise<{ error: Error | null }> {
    if (taskIds.length === 0) return { error: null };

    let query = this.supabase
      .from("task_attachments")
      .select("storage_path")
      .in("task_id", taskIds);
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    if (error) return { error: error as Error };

    const paths = (data as { storage_path: string }[] | null)?.map(
      (r) => r.storage_path
    );
    if (!paths?.length) return { error: null };

    const { error: storageError } = await this.supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove(paths);
    return { error: (storageError as Error | null) ?? null };
  }

  /**
   * Signed URLs for a set of attachments, keyed by attachment id.
   *
   * The bucket is private, so this is the only way to render an image or hand
   * out a download. One batched call rather than one per file: an image-heavy
   * task would otherwise open a request per thumbnail before anything paints.
   * Attachments that fail to sign are simply absent from the map — the caller
   * shows those as unavailable rather than the whole set failing together.
   */
  async signedUrls(
    attachments: TaskAttachment[],
    options?: { expiresIn?: number }
  ): Promise<{ data: Map<string, string>; error: Error | null }> {
    const urls = new Map<string, string>();
    if (attachments.length === 0) return { data: urls, error: null };

    const { data, error } = await this.supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrls(
        attachments.map((a) => a.storage_path),
        options?.expiresIn ?? ATTACHMENT_SIGNED_URL_TTL_SECONDS
      );
    if (error) return { data: urls, error: error as Error };

    const byPath = new Map(
      (data ?? [])
        .filter((r) => r.signedUrl && !r.error)
        .map((r) => [r.path ?? "", r.signedUrl])
    );
    for (const a of attachments) {
      const url = byPath.get(a.storage_path);
      if (url) urls.set(a.id, url);
    }
    return { data: urls, error: null };
  }

  /**
   * A signed URL that downloads under the attachment's original filename
   * rather than its opaque storage key.
   */
  async downloadUrl(
    attachment: TaskAttachment
  ): Promise<{ data: string | null; error: Error | null }> {
    const { data, error } = await this.supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(
        attachment.storage_path,
        ATTACHMENT_SIGNED_URL_TTL_SECONDS,
        { download: attachment.file_name }
      );
    return { data: data?.signedUrl ?? null, error: error as Error | null };
  }

  /**
   * Pull a text attachment's content down for inline rendering.
   *
   * Refuses anything past the preview ceiling instead of streaming a 10 MB log
   * into a card nobody asked to expand.
   */
  async fetchText(
    attachment: TaskAttachment
  ): Promise<{ data: string | null; error: Error | null }> {
    if (attachment.size_bytes > ATTACHMENT_TEXT_PREVIEW_MAX_BYTES) {
      return {
        data: null,
        error: new Error("That file is too large to preview here."),
      };
    }
    const { data, error } = await this.supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .download(attachment.storage_path);
    if (error || !data) return { data: null, error: error as Error };
    return { data: await data.text(), error: null };
  }
}
