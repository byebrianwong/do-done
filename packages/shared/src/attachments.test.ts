import { describe, it, expect } from "vitest";
import {
  attachmentKind,
  attachmentStoragePath,
  fileExtension,
  formatFileSize,
  isTextKind,
} from "./attachments.js";

describe("fileExtension", () => {
  it("lowercases and drops the dot", () => {
    expect(fileExtension("Notes.MD")).toBe("md");
    expect(fileExtension("photo.JPEG")).toBe("jpeg");
  });

  it("takes the last extension only", () => {
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });

  it("ignores directories in the name", () => {
    expect(fileExtension("a.png/b.txt")).toBe("txt");
    expect(fileExtension("C:\\docs\\report.pdf")).toBe("pdf");
  });

  it("returns empty for names without a usable extension", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".env")).toBe(""); // dotfile: the dot names the file
    expect(fileExtension("trailing.")).toBe("");
  });
});

describe("attachmentKind", () => {
  it("classifies markdown by extension whatever the OS claimed", () => {
    // The three types a .md file actually arrives with, from a browser, from
    // Android's document picker, and from a drag-and-drop respectively.
    expect(attachmentKind("text/plain", "spec.md")).toBe("markdown");
    expect(attachmentKind("application/octet-stream", "spec.md")).toBe("markdown");
    expect(attachmentKind("", "spec.markdown")).toBe("markdown");
    expect(attachmentKind(null, "spec.mdx")).toBe("markdown");
  });

  it("falls back to the MIME type when the name carries no extension", () => {
    expect(attachmentKind("text/markdown", "clipboard")).toBe("markdown");
    expect(attachmentKind("image/png", "pasted-image")).toBe("image");
    expect(attachmentKind("application/pdf", "scan")).toBe("pdf");
    expect(attachmentKind("text/csv", "export")).toBe("text");
    expect(attachmentKind("application/zip", "bundle")).toBe("file");
  });

  it("ignores MIME parameters", () => {
    expect(attachmentKind("text/plain; charset=utf-8", "notes")).toBe("text");
  });

  it("never treats SVG as an inline image", () => {
    // An SVG can carry <script>, and inlining one would run it in the app's
    // own origin. It stays a download by both signals.
    expect(attachmentKind("image/svg+xml", "logo.svg")).toBe("file");
    expect(attachmentKind("image/svg+xml", "logo")).toBe("file");
  });

  it("classifies images and text by extension", () => {
    expect(attachmentKind("application/octet-stream", "shot.png")).toBe("image");
    expect(attachmentKind("application/octet-stream", "data.csv")).toBe("text");
    expect(attachmentKind("application/octet-stream", "doc.pdf")).toBe("pdf");
  });

  it("classifies a voice note as audio however it is labelled", () => {
    // The recogniser writes WAV, and both platforms hand one back as
    // octet-stream often enough that the extension has to be what decides —
    // otherwise the app's own recordings render as anonymous download chips.
    expect(attachmentKind("application/octet-stream", "voice-note-2026-08-08-090403.wav")).toBe("audio");
    expect(attachmentKind("", "memo.m4a")).toBe("audio");
    expect(attachmentKind(null, "clip.caf")).toBe("audio");
    // A bare .webm could equally be video, so there the type is the only
    // signal that says which — and it is trusted.
    expect(attachmentKind("audio/webm", "clip.webm")).toBe("audio");
    expect(attachmentKind("audio/mpeg", "recording")).toBe("audio");
  });

  it("defaults to a plain file", () => {
    expect(attachmentKind("application/octet-stream", "design.sketch")).toBe("file");
    expect(attachmentKind(undefined, "unknown")).toBe("file");
  });
});

describe("isTextKind", () => {
  it("covers the kinds rendered from file content", () => {
    expect(isTextKind("markdown")).toBe(true);
    expect(isTextKind("text")).toBe(true);
    expect(isTextKind("image")).toBe(false);
    expect(isTextKind("audio")).toBe(false);
    expect(isTextKind("pdf")).toBe(false);
    expect(isTextKind("file")).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("formats across the ranges", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_500_000)).toBe("1.4 MB");
    expect(formatFileSize(12_000_000)).toBe("11 MB");
  });
});

describe("attachmentStoragePath", () => {
  const user = "11111111-1111-1111-1111-111111111111";
  const task = "22222222-2222-2222-2222-222222222222";

  it("puts the owner first so Storage RLS can authorize on the path", () => {
    const path = attachmentStoragePath(user, task, "abc", "Photo.PNG");
    expect(path).toBe(`${user}/${task}/abc.png`);
    expect(path.split("/")[0]).toBe(user);
  });

  it("omits the extension when the name has none", () => {
    expect(attachmentStoragePath(user, task, "abc", "README")).toBe(
      `${user}/${task}/abc`
    );
  });

  it("never carries the user's filename into the key", () => {
    // The original name lives in the DB row and is re-applied at download
    // time; keeping it out of the key is what makes the key unguessable.
    const path = attachmentStoragePath(user, task, "abc", "salary review.pdf");
    expect(path).not.toContain("salary");
    expect(path).not.toContain(" ");
  });
});
