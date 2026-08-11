import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { TaskAttachment } from "@do-done/shared";
import type { AttachmentsApi } from "@do-done/api-client";
import { AttachmentsSection } from "./task-attachments";
import { makeAttachment } from "./__stories__/mocks";

/**
 * A recording stand-in for AttachmentsApi. Only the five methods the section
 * calls are implemented; anything else would be dead weight in the assertions.
 */
function makeApi(options: {
  attachments?: TaskAttachment[];
  urls?: Record<string, string>;
  text?: Record<string, string>;
  uploadResult?: { data: TaskAttachment | null; error: Error | null };
  removeError?: Error | null;
}) {
  const uploads: { taskId: string; fileName: string }[] = [];
  const removed: string[] = [];
  const api = {
    async list() {
      return { data: options.attachments ?? [], error: null };
    },
    async signedUrls(list: TaskAttachment[]) {
      const map = new Map<string, string>();
      for (const a of list) {
        const u = options.urls?.[a.id];
        if (u) map.set(a.id, u);
      }
      return { data: map, error: null };
    },
    async fetchText(a: TaskAttachment) {
      return { data: options.text?.[a.id] ?? "", error: null };
    },
    async downloadUrl() {
      return { data: "https://signed.example/dl", error: null };
    },
    async upload(taskId: string, file: { fileName: string }) {
      uploads.push({ taskId, fileName: file.fileName });
      return options.uploadResult ?? { data: null, error: new Error("nope") };
    },
    async remove(a: TaskAttachment) {
      removed.push(a.id);
      return { error: options.removeError ?? null };
    },
  };
  return { api: api as unknown as AttachmentsApi, uploads, removed };
}

function pick(name: string, type: string, size = 10): File {
  const file = new File(["x"], name, { type });
  // `File` has no writable size; a test that needs a big one has to fake it.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("AttachmentsSection — rendering by file kind", () => {
  it("shows an image inline under its signed URL", async () => {
    const image = makeAttachment({ id: "a1", file_name: "shot.png" });
    const { api } = makeApi({
      attachments: [image],
      urls: { a1: "https://signed.example/shot.png" },
    });

    render(<AttachmentsSection taskId="task-1" api={api} />);

    const img = await screen.findByAltText("shot.png");
    expect(img).toHaveAttribute("src", "https://signed.example/shot.png");
  });

  it("renders a markdown attachment as formatted text, not raw source", async () => {
    const doc = makeAttachment({
      id: "a2",
      file_name: "notes.md",
      mime_type: "text/markdown",
    });
    const { api } = makeApi({
      attachments: [doc],
      text: { a2: "# Heading\n\nA **bold** word." },
    });

    render(<AttachmentsSection taskId="task-1" api={api} />);

    // The heading is a real heading, and the marker characters are gone.
    expect(
      await screen.findByRole("heading", { name: "Heading" })
    ).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.queryByText(/# Heading/)).not.toBeInTheDocument();
  });

  it("renders a plain-text attachment verbatim rather than parsing it", async () => {
    const log = makeAttachment({
      id: "a3",
      file_name: "build.log",
      mime_type: "text/plain",
    });
    const { api } = makeApi({
      attachments: [log],
      text: { a3: "# not a heading\n* not a bullet" },
    });

    render(<AttachmentsSection taskId="task-1" api={api} />);

    await waitFor(() =>
      expect(screen.getByText(/not a heading/)).toBeInTheDocument()
    );
    expect(screen.queryByRole("heading", { name: /not a heading/ })).toBeNull();
  });

  it("never interprets HTML inside an attached markdown file", async () => {
    const doc = makeAttachment({
      id: "a4",
      file_name: "evil.md",
      mime_type: "text/markdown",
    });
    const { api } = makeApi({
      attachments: [doc],
      // Attachment content is untrusted; `rehype-raw` is deliberately absent,
      // so this has to come out as visible text and never as an element.
      text: { a4: '<img src=x onerror="alert(1)"> and <b>markup</b>' },
    });

    const { container } = render(
      <AttachmentsSection taskId="task-1" api={api} />
    );

    await waitFor(() => expect(screen.getByText(/markup/)).toBeInTheDocument());
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("offers an opaque binary as a download row with no preview", async () => {
    const zip = makeAttachment({
      id: "a5",
      file_name: "assets.zip",
      mime_type: "application/zip",
      size_bytes: 8_400_000,
    });
    const { api } = makeApi({ attachments: [zip] });

    const { container } = render(
      <AttachmentsSection taskId="task-1" api={api} />
    );

    expect(await screen.findByText("assets.zip")).toBeInTheDocument();
    expect(screen.getByText("8 MB")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps an SVG out of the inline image path", async () => {
    // An SVG can carry a <script>; inlining one would run it in the app's own
    // origin, so it renders as a download row like any other binary.
    const svg = makeAttachment({
      id: "a6",
      file_name: "logo.svg",
      mime_type: "image/svg+xml",
    });
    const { api } = makeApi({
      attachments: [svg],
      urls: { a6: "https://signed.example/logo.svg" },
    });

    const { container } = render(
      <AttachmentsSection taskId="task-1" api={api} />
    );

    expect(await screen.findByText("logo.svg")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("AttachmentsSection — uploading", () => {
  it("uploads a picked file", async () => {
    const uploaded = makeAttachment({ id: "new", file_name: "spec.md" });
    const { api, uploads } = makeApi({
      attachments: [],
      uploadResult: { data: uploaded, error: null },
    });

    const { container } = render(
      <AttachmentsSection taskId="task-42" api={api} />
    );
    const input = container.querySelector(
      "input[type=file]"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pick("spec.md", "text/markdown")] } });

    await waitFor(() =>
      expect(uploads).toEqual([{ taskId: "task-42", fileName: "spec.md" }])
    );
    expect(await screen.findByText("spec.md")).toBeInTheDocument();
  });

  it("rejects an over-limit file without sending a byte", async () => {
    const { api, uploads } = makeApi({ attachments: [] });

    const { container } = render(
      <AttachmentsSection taskId="task-1" api={api} />
    );
    const input = container.querySelector(
      "input[type=file]"
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [pick("huge.png", "image/png", 50 * 1024 * 1024)] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/huge\.png/);
    expect(uploads).toHaveLength(0);
  });

  it("uploads a dropped file", async () => {
    const uploaded = makeAttachment({ id: "new", file_name: "dropped.png" });
    const { api, uploads } = makeApi({
      attachments: [],
      uploadResult: { data: uploaded, error: null },
    });

    render(<AttachmentsSection taskId="task-1" api={api} />);
    const zone = screen.getByText(/Attach a file/).closest("div")!;
    fireEvent.drop(zone, {
      dataTransfer: { files: [pick("dropped.png", "image/png")] },
    });

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]!.fileName).toBe("dropped.png");
  });

  it("reports an upload failure instead of showing a phantom attachment", async () => {
    const { api } = makeApi({
      attachments: [],
      uploadResult: { data: null, error: new Error("Storage is down.") },
    });

    const { container } = render(
      <AttachmentsSection taskId="task-1" api={api} />
    );
    const input = container.querySelector(
      "input[type=file]"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pick("a.png", "image/png")] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is down.");
    expect(screen.queryByText("a.png")).toBeNull();
  });
});

describe("AttachmentsSection — removing", () => {
  it("drops the row immediately", async () => {
    const zip = makeAttachment({ id: "a1", file_name: "assets.zip", mime_type: "application/zip" });
    const { api, removed } = makeApi({ attachments: [zip] });

    render(<AttachmentsSection taskId="task-1" api={api} />);
    fireEvent.click(await screen.findByLabelText("Remove assets.zip"));

    await waitFor(() => expect(screen.queryByText("assets.zip")).toBeNull());
    expect(removed).toEqual(["a1"]);
  });

  it("puts the row back when the delete failed", async () => {
    const zip = makeAttachment({ id: "a1", file_name: "assets.zip", mime_type: "application/zip" });
    const { api } = makeApi({
      attachments: [zip],
      removeError: new Error("network"),
    });

    render(<AttachmentsSection taskId="task-1" api={api} />);
    fireEvent.click(await screen.findByLabelText("Remove assets.zip"));

    // The optimistic removal is reverted, and the user is told why.
    expect(await screen.findByRole("alert")).toHaveTextContent(/assets\.zip/);
    expect(await screen.findByText("assets.zip")).toBeInTheDocument();
  });
});

describe("AttachmentsSection — image lightbox", () => {
  it("opens the full-size view and closes it on Escape without closing the editor", async () => {
    const image = makeAttachment({ id: "a1", file_name: "shot.png" });
    const { api } = makeApi({
      attachments: [image],
      urls: { a1: "https://signed.example/shot.png" },
    });
    // Stands in for the task modal's own Escape handler, which is bound on the
    // window and must not fire while the lightbox is up.
    const editorEscape = vi.fn();
    window.addEventListener("keydown", editorEscape);

    render(<AttachmentsSection taskId="task-1" api={api} />);
    fireEvent.click(await screen.findByLabelText("Open shot.png full size"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    editorEscape.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(editorEscape).not.toHaveBeenCalled();
    window.removeEventListener("keydown", editorEscape);
  });
});

describe("AttachmentsSection — nothing attached yet", () => {
  // Most tasks, most of the time. A caps heading over an empty bordered well
  // announces a section with nothing in it; a task with no files should cost
  // one line, and that line is the button.
  it("is a button, with no heading and no well", async () => {
    const { api } = makeApi({ attachments: [] });
    render(<AttachmentsSection taskId="task-1" api={api} />);

    expect(
      await screen.findByText("Attach a file", { exact: false })
    ).toBeInTheDocument();
    expect(screen.queryByText("Attachments")).toBeNull();
  });

  it("names the section again once something is in it", async () => {
    const { api } = makeApi({
      attachments: [makeAttachment({ id: "a1", file_name: "shot.png" })],
      urls: { a1: "https://signed.example/shot.png" },
    });
    render(<AttachmentsSection taskId="task-1" api={api} />);

    expect(await screen.findByText("Attachments")).toBeInTheDocument();
  });
});
