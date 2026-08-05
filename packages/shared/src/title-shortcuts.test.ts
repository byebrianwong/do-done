import { describe, it, expect } from "vitest";
import { extractTitleShortcuts } from "./title-shortcuts.js";

describe("extractTitleShortcuts", () => {
  describe("space-terminated tokens", () => {
    it("classifies a size token as an estimate, not a tag", () => {
      const r = extractTitleShortcuts("buy toothpaste #xs ");
      expect(r.durationMinutes).toBe(30);
      expect(r.tags).toEqual([]);
      expect(r.stripped).toBe("buy toothpaste");
    });

    it("classifies a priority token as a priority, not a tag", () => {
      const r = extractTitleShortcuts("ship widget #p1 ");
      expect(r.priority).toBe("p1");
      expect(r.tags).toEqual([]);
      expect(r.stripped).toBe("ship widget");
    });

    it("treats anything else as a tag", () => {
      const r = extractTitleShortcuts("email bob #work ");
      expect(r.tags).toEqual(["work"]);
      expect(r.priority).toBeUndefined();
      expect(r.durationMinutes).toBeUndefined();
      expect(r.stripped).toBe("email bob");
    });

    it("handles all three kinds at once", () => {
      const r = extractTitleShortcuts("plan trip #p2 #l #travel ");
      expect(r.priority).toBe("p2");
      expect(r.durationMinutes).toBe(240);
      expect(r.tags).toEqual(["travel"]);
      expect(r.stripped).toBe("plan trip");
    });

    it("covers every size shortcut", () => {
      const sizes: [string, number][] = [
        ["xs", 30],
        ["s", 60],
        ["m", 120],
        ["l", 240],
        ["xl", 480],
        ["xxl", 960],
      ];
      for (const [token, minutes] of sizes) {
        expect(extractTitleShortcuts(`t #${token} `).durationMinutes).toBe(
          minutes
        );
      }
    });

    it("is case-insensitive when classifying", () => {
      const r = extractTitleShortcuts("t #XS #P3 ");
      expect(r.durationMinutes).toBe(30);
      expect(r.priority).toBe("p3");
    });
  });

  describe("partial tokens while typing", () => {
    it("leaves an unterminated token alone", () => {
      // `#x` must survive the trip to `#xs`.
      const r = extractTitleShortcuts("buy toothpaste #x");
      expect(r.stripped).toBe("buy toothpaste #x");
      expect(r.durationMinutes).toBeUndefined();
      expect(r.tags).toEqual([]);
    });

    it("leaves an unterminated tag alone", () => {
      const r = extractTitleShortcuts("email bob #wor");
      expect(r.stripped).toBe("email bob #wor");
      expect(r.tags).toEqual([]);
    });
  });

  describe("flushTrailing", () => {
    it("consumes a trailing token with no trailing space", () => {
      // The reported bug: typing "buy toothpaste #xs" and stopping.
      const r = extractTitleShortcuts("buy toothpaste #xs", true);
      expect(r.durationMinutes).toBe(30);
      expect(r.stripped).toBe("buy toothpaste");
    });

    it("consumes a trailing priority", () => {
      const r = extractTitleShortcuts("ship widget #p1", true);
      expect(r.priority).toBe("p1");
      expect(r.stripped).toBe("ship widget");
    });

    it("consumes a trailing tag", () => {
      const r = extractTitleShortcuts("email bob #work", true);
      expect(r.tags).toEqual(["work"]);
      expect(r.stripped).toBe("email bob");
    });

    it("leaves no trailing whitespace behind", () => {
      expect(extractTitleShortcuts("a #work", true).stripped).toBe("a");
      expect(extractTitleShortcuts("a #work ", true).stripped).toBe("a");
    });

    it("still handles mid-string tokens", () => {
      const r = extractTitleShortcuts("call #work bob #p1", true);
      expect(r.tags).toEqual(["work"]);
      expect(r.priority).toBe("p1");
      expect(r.stripped).toBe("call bob");
    });
  });

  describe("no-op cases", () => {
    it("returns the text untouched when there is no token", () => {
      const r = extractTitleShortcuts("just a normal title", true);
      expect(r.stripped).toBe("just a normal title");
      expect(r.tags).toEqual([]);
    });

    it("leaves a bare # alone", () => {
      expect(extractTitleShortcuts("a # b", true).stripped).toBe("a # b");
    });

    it("does not treat a bare word as a size code", () => {
      // The `#` is required — "s" and "m" are far too common in English.
      const r = extractTitleShortcuts("read s notes", true);
      expect(r.durationMinutes).toBeUndefined();
      expect(r.stripped).toBe("read s notes");
    });
  });
});
