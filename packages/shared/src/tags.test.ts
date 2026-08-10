import { describe, it, expect } from "vitest";
import {
  summarizeTags,
  encodeTagParam,
  decodeTagParam,
  tasksWithTag,
  type TaggedRow,
} from "./tags.js";

const row = (status: string, ...tags: string[]): TaggedRow => ({ status, tags });

describe("summarizeTags", () => {
  it("counts each tag once per task, open and total", () => {
    const summary = summarizeTags([
      row("inbox", "home", "errand"),
      row("next", "home"),
      row("done", "home"),
    ]);

    expect(summary).toEqual([
      { tag: "home", task_count: 3, open_count: 2 },
      { tag: "errand", task_count: 1, open_count: 1 },
    ]);
  });

  it("keeps a tag whose work is all finished", () => {
    expect(summarizeTags([row("done", "shipped")])).toEqual([
      { tag: "shipped", task_count: 1, open_count: 0 },
    ]);
  });

  it("treats cancelled and archived as closed, like every other count", () => {
    const summary = summarizeTags([
      row("cancelled", "x"),
      row("archived", "x"),
      row("in_progress", "x"),
    ]);
    expect(summary).toEqual([{ tag: "x", task_count: 3, open_count: 1 }]);
  });

  it("counts a task once even if it carries the same tag twice", () => {
    expect(summarizeTags([row("inbox", "dupe", "dupe")])).toEqual([
      { tag: "dupe", task_count: 1, open_count: 1 },
    ]);
  });

  it("does not fold case — the count must match what the filter returns", () => {
    const summary = summarizeTags([row("inbox", "Work"), row("inbox", "work")]);
    expect(summary.map((s) => s.tag).sort()).toEqual(["Work", "work"]);
  });

  it("orders by open work, then alphabetically", () => {
    const summary = summarizeTags([
      row("inbox", "b"),
      row("inbox", "a"),
      row("inbox", "busy"),
      row("inbox", "busy"),
    ]);
    expect(summary.map((s) => s.tag)).toEqual(["busy", "a", "b"]);
  });

  it("ignores empty tags and absent arrays", () => {
    expect(summarizeTags([{ status: "inbox", tags: null }, row("inbox", "")]))
      .toEqual([]);
  });
});

describe("tag params", () => {
  it("round-trips a tag that needs escaping", () => {
    for (const tag of ["home", "side project", "a/b", "c&d", "ünï"]) {
      expect(decodeTagParam(encodeTagParam(tag))).toBe(tag);
    }
  });

  it("returns a malformed segment rather than throwing", () => {
    expect(decodeTagParam("%zz")).toBe("%zz");
  });
});

describe("tasksWithTag", () => {
  it("matches exactly", () => {
    const tasks = [
      { id: "1", tags: ["home"] },
      { id: "2", tags: ["Home"] },
      { id: "3", tags: null },
    ];
    expect(tasksWithTag(tasks, "home").map((t) => t.id)).toEqual(["1"]);
  });
});
