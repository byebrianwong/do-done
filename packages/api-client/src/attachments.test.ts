import { describe, it, expect, vi } from "vitest";
import type { TaskAttachment } from "@do-done/shared";
import { AttachmentsApi, AttachmentTooLargeError } from "./attachments.js";

const USER = "00000000-0000-0000-0000-0000000000aa";
const TASK = "00000000-0000-0000-0000-0000000000bb";

function makeAttachment(overrides: Partial<TaskAttachment> = {}): TaskAttachment {
  return {
    id: "00000000-0000-0000-0000-0000000000cc",
    task_id: TASK,
    user_id: USER,
    storage_path: `${USER}/${TASK}/abc.png`,
    file_name: "shot.png",
    mime_type: "image/png",
    size_bytes: 1024,
    created_at: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Stubs the two surfaces AttachmentsApi talks to: the Postgres query builder
 * (chainable + awaitable) and the Storage bucket client. `tableResult` is what
 * awaiting a query resolves to; the storage functions are spies so tests can
 * assert on ordering and on what gets cleaned up after a failure.
 */
function makeStub(options?: {
  tableResult?: { data: unknown; error: unknown };
  insertResult?: { data: unknown; error: unknown };
  uploadError?: Error | null;
}) {
  const order: string[] = [];
  const storage = {
    upload: vi.fn(async (_path: string, _body: unknown, _opts?: unknown) => {
      order.push("storage.upload");
      return { data: null, error: options?.uploadError ?? null };
    }),
    remove: vi.fn(async (_paths: string[]) => {
      order.push("storage.remove");
      return { data: null, error: null };
    }),
    createSignedUrls: vi.fn(async () => ({ data: [], error: null })),
    createSignedUrl: vi.fn(async () => ({
      data: { signedUrl: "https://signed.example/x" },
      error: null,
    })),
    download: vi.fn(async () => ({ data: null, error: null })),
  };

  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  const chain = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    order.push(`db.${method}`);
    return builder;
  };
  for (const m of ["from", "select", "insert", "delete", "eq", "in", "order"]) {
    builder[m] = chain(m);
  }
  builder.single = () => ({
    then: (resolve: (v: unknown) => unknown) =>
      resolve(options?.insertResult ?? { data: makeAttachment(), error: null }),
  });
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(options?.tableResult ?? { data: [], error: null });

  const supabase = {
    from: chain("from"),
    storage: { from: () => storage },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: USER } } } }),
    },
  };
  return { supabase, storage, calls, order };
}

describe("AttachmentsApi.upload", () => {
  it("rejects an oversized file before uploading anything", async () => {
    const { supabase, storage } = makeStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    const { data, error } = await api.upload(TASK, {
      fileName: "huge.png",
      mimeType: "image/png",
      size: 50 * 1024 * 1024,
      body: new Uint8Array(0),
    });

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(AttachmentTooLargeError);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("writes the bytes before the row", async () => {
    const { supabase, order } = makeStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    await api.upload(TASK, {
      fileName: "shot.png",
      mimeType: "image/png",
      size: 10,
      body: new Uint8Array(10),
    });

    // A row pointing at bytes that never arrived renders as a permanently
    // broken attachment; bytes with no row are merely invisible.
    expect(order.indexOf("storage.upload")).toBeLessThan(
      order.indexOf("db.insert")
    );
  });

  it("uploads under a key that starts with the owner's id", async () => {
    const { supabase, storage } = makeStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    await api.upload(TASK, {
      fileName: "Report.PDF",
      mimeType: "application/pdf",
      size: 10,
      body: new Uint8Array(10),
    });

    const path = storage.upload.mock.calls[0]![0];
    // Storage RLS authorizes on the first path segment and nothing else.
    expect(path.startsWith(`${USER}/${TASK}/`)).toBe(true);
    expect(path.endsWith(".pdf")).toBe(true);
  });

  it("removes the uploaded bytes when the metadata row fails", async () => {
    const { supabase, storage } = makeStub({
      insertResult: { data: null, error: new Error("rls") },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    const { data, error } = await api.upload(TASK, {
      fileName: "shot.png",
      mimeType: "image/png",
      size: 10,
      body: new Uint8Array(10),
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    // The failure leaves nothing behind — no orphaned object in the bucket.
    expect(storage.remove).toHaveBeenCalledOnce();
  });

  it("never inserts a row when the upload itself failed", async () => {
    const { supabase, order } = makeStub({ uploadError: new Error("network") });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    const { error } = await api.upload(TASK, {
      fileName: "shot.png",
      mimeType: "image/png",
      size: 10,
      body: new Uint8Array(10),
    });

    expect(error).toBeTruthy();
    expect(order).not.toContain("db.insert");
  });

  it("falls back to the session for the owner id", async () => {
    const { supabase, storage } = makeStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any); // no userId

    await api.upload(TASK, {
      fileName: "a.txt",
      mimeType: "text/plain",
      size: 1,
      body: new Uint8Array(1),
    });

    const path = storage.upload.mock.calls[0]![0];
    expect(path.startsWith(`${USER}/`)).toBe(true);
  });
});

describe("AttachmentsApi.remove", () => {
  it("deletes the bytes before the row", async () => {
    const { supabase, order } = makeStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    await api.remove(makeAttachment());

    expect(order.indexOf("storage.remove")).toBeLessThan(
      order.indexOf("db.delete")
    );
  });

  it("keeps the row when the bytes could not be deleted", async () => {
    const { supabase, storage, order } = makeStub();
    storage.remove.mockResolvedValueOnce({
      data: null,
      error: new Error("network") as never,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    const { error } = await api.remove(makeAttachment());

    // Dropping the row here would strand the bytes with nothing pointing at
    // them; keeping it lets the user retry.
    expect(error).toBeTruthy();
    expect(order).not.toContain("db.delete");
  });
});

describe("AttachmentsApi.removeForTasks", () => {
  it("does nothing for an empty task list", async () => {
    const { supabase, storage } = makeStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    const { error } = await api.removeForTasks([]);

    expect(error).toBeNull();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("removes every object belonging to the tasks in one call", async () => {
    const { supabase, storage } = makeStub({
      tableResult: {
        data: [{ storage_path: "u/t/1.png" }, { storage_path: "u/t/2.md" }],
        error: null,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    await api.removeForTasks([TASK, "other"]);

    expect(storage.remove).toHaveBeenCalledWith(["u/t/1.png", "u/t/2.md"]);
  });

  it("skips the storage call when the tasks had no attachments", async () => {
    const { supabase, storage } = makeStub({
      tableResult: { data: [], error: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    await api.removeForTasks([TASK]);

    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe("AttachmentsApi.signedUrls", () => {
  it("signs nothing for an empty set", async () => {
    const { supabase, storage } = makeStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    const { data } = await api.signedUrls([]);

    expect(data.size).toBe(0);
    expect(storage.createSignedUrls).not.toHaveBeenCalled();
  });

  it("keys the map by attachment id, not by storage path", async () => {
    const { supabase, storage } = makeStub();
    const a = makeAttachment({ id: "id-1", storage_path: "p/1.png" });
    const b = makeAttachment({ id: "id-2", storage_path: "p/2.png" });
    storage.createSignedUrls.mockResolvedValueOnce({
      data: [
        { path: "p/1.png", signedUrl: "https://s/1", error: null },
        { path: "p/2.png", signedUrl: "https://s/2", error: null },
      ],
      error: null,
    } as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    const { data } = await api.signedUrls([a, b]);

    expect(data.get("id-1")).toBe("https://s/1");
    expect(data.get("id-2")).toBe("https://s/2");
  });

  it("omits the ones that failed to sign rather than failing the batch", async () => {
    const { supabase, storage } = makeStub();
    const a = makeAttachment({ id: "id-1", storage_path: "p/1.png" });
    const b = makeAttachment({ id: "id-2", storage_path: "p/2.png" });
    storage.createSignedUrls.mockResolvedValueOnce({
      data: [
        { path: "p/1.png", signedUrl: "https://s/1", error: null },
        { path: "p/2.png", signedUrl: null, error: "not found" },
      ],
      error: null,
    } as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    const { data, error } = await api.signedUrls([a, b]);

    expect(error).toBeNull();
    expect(data.get("id-1")).toBe("https://s/1");
    expect(data.has("id-2")).toBe(false);
  });
});

describe("AttachmentsApi.fetchText", () => {
  it("refuses to pull down a file past the preview ceiling", async () => {
    const { supabase, storage } = makeStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    const { data, error } = await api.fetchText(
      makeAttachment({ file_name: "huge.log", size_bytes: 5 * 1024 * 1024 })
    );

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("returns the file's text", async () => {
    const { supabase, storage } = makeStub();
    storage.download.mockResolvedValueOnce({
      data: { text: async () => "# Title" },
      error: null,
    } as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new AttachmentsApi(supabase as any, USER);

    const { data } = await api.fetchText(
      makeAttachment({ file_name: "notes.md", size_bytes: 7 })
    );

    expect(data).toBe("# Title");
  });
});
