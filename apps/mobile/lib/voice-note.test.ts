import { beforeEach, describe, expect, it, vi } from "vitest";

// `expo-file-system` reaches for native code, so it's replaced here the way
// every other native seam in this suite is. The double records what was read
// and what was deleted, which is the thing worth asserting: a failed upload
// must not destroy the only copy of what the user said.
const reads = vi.fn<(uri: string) => Uint8Array>();
const deletes = vi.fn<(uri: string) => void>();

vi.mock("expo-file-system", () => ({
  File: class {
    constructor(private uri: string) {}
    async bytes() {
      return reads(this.uri);
    }
    delete() {
      deletes(this.uri);
    }
  },
}));

const { attachVoiceNote, describeRecording } = await import("./voice-note");

/** Minimal stand-in for AttachmentsApi — only `upload` is reached. */
function fakeApi(result: { data: unknown; error: Error | null }) {
  const upload = vi.fn(async () => result);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { api: { upload } as any, upload };
}

const STARTED_AT = new Date(2026, 7, 8, 9, 4, 3).getTime();

beforeEach(() => {
  reads.mockReset();
  deletes.mockReset();
  reads.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
});

describe("describeRecording", () => {
  it("names and types the file from what Android wrote", () => {
    expect(
      describeRecording("file:///cache/recording_1720678500903.wav", STARTED_AT)
    ).toEqual({
      fileName: "voice-note-2026-08-08-090403.wav",
      mimeType: "audio/wav",
    });
  });

  it("follows iOS to CAF rather than assuming WAV", () => {
    // Getting this wrong classifies the app's own recording as an anonymous
    // download chip, since attachmentKind reads the extension first.
    expect(
      describeRecording("file:///Library/Caches/audio_CD5E.caf", STARTED_AT)
    ).toEqual({
      fileName: "voice-note-2026-08-08-090403.caf",
      mimeType: "audio/x-caf",
    });
  });

  it("falls back to wav when the URI carries no extension", () => {
    const { fileName, mimeType } = describeRecording(
      "file:///cache/recording",
      STARTED_AT
    );
    expect(fileName).toBe("voice-note-2026-08-08-090403.wav");
    expect(mimeType).toBe("audio/wav");
  });

  it("ignores a query string on the URI", () => {
    expect(
      describeRecording("file:///cache/rec.wav?take=2", STARTED_AT).fileName
    ).toBe("voice-note-2026-08-08-090403.wav");
  });
});

describe("attachVoiceNote", () => {
  it("uploads the bytes under a voice-note name and clears the cache file", async () => {
    const { api, upload } = fakeApi({ data: { id: "att-1" }, error: null });

    const { data, error } = await attachVoiceNote(api, "task-1", {
      audioUri: "file:///cache/recording_1.wav",
      startedAt: STARTED_AT,
    });

    expect(error).toBeNull();
    expect(data).toEqual({ id: "att-1" });
    expect(upload).toHaveBeenCalledWith("task-1", {
      fileName: "voice-note-2026-08-08-090403.wav",
      mimeType: "audio/wav",
      size: 4,
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(deletes).toHaveBeenCalledWith("file:///cache/recording_1.wav");
  });

  it("keeps the local copy when the upload fails", async () => {
    const { api } = fakeApi({ data: null, error: new Error("offline") });

    const { error } = await attachVoiceNote(api, "task-1", {
      audioUri: "file:///cache/recording_1.wav",
      startedAt: STARTED_AT,
    });

    expect(error?.message).toBe("offline");
    expect(deletes).not.toHaveBeenCalled();
  });

  it("reports a recording that produced no audio without calling upload", async () => {
    const { api, upload } = fakeApi({ data: null, error: null });

    const { data, error } = await attachVoiceNote(api, "task-1", {
      audioUri: null,
      startedAt: STARTED_AT,
    });

    expect(data).toBeNull();
    expect(error?.message).toContain("no audio");
    expect(upload).not.toHaveBeenCalled();
  });

  it("reports an unreadable file rather than throwing at the caller", async () => {
    reads.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const { api, upload } = fakeApi({ data: null, error: null });

    const { error } = await attachVoiceNote(api, "task-1", {
      audioUri: "file:///cache/gone.wav",
      startedAt: STARTED_AT,
    });

    expect(error?.message).toBe("Couldn't read the recording.");
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not fail the attach when the cache file can't be deleted", async () => {
    deletes.mockImplementation(() => {
      throw new Error("EPERM");
    });
    const { api } = fakeApi({ data: { id: "att-1" }, error: null });

    const { data, error } = await attachVoiceNote(api, "task-1", {
      audioUri: "file:///cache/recording_1.wav",
      startedAt: STARTED_AT,
    });

    expect(error).toBeNull();
    expect(data).toEqual({ id: "att-1" });
  });
});
