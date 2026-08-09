import { describe, it, expect } from "vitest";
import {
  classifyShortcutToken,
  extractTitleShortcuts,
} from "./title-shortcuts.js";

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

  describe("project matching", () => {
    const PROJECTS = [
      { id: "p-home", name: "Home" },
      { id: "p-side", name: "Side Project" },
    ];

    it("routes a #token naming a project to projectId, not tags", () => {
      const r = extractTitleShortcuts("fix the sink #home ", false, PROJECTS);
      expect(r.projectId).toBe("p-home");
      expect(r.tags).toEqual([]);
      expect(r.stripped).toBe("fix the sink");
    });

    it("matches a multi-word name through its normalised key", () => {
      expect(
        extractTitleShortcuts("ship #sideproject ", false, PROJECTS).projectId
      ).toBe("p-side");
      expect(
        extractTitleShortcuts("ship #Side_Project ", false, PROJECTS).projectId
      ).toBe("p-side");
    });

    it("still tags a token that names no project", () => {
      const r = extractTitleShortcuts("fix the sink #plumbing ", false, PROJECTS);
      expect(r.projectId).toBeUndefined();
      expect(r.tags).toEqual(["plumbing"]);
    });

    it("tags every token when no project list is passed", () => {
      const r = extractTitleShortcuts("fix the sink #home ");
      expect(r.projectId).toBeUndefined();
      expect(r.tags).toEqual(["home"]);
    });

    it("lets size and priority codes win over a same-named project", () => {
      const r = extractTitleShortcuts("ship #m #p1 ", false, [
        { id: "p-m", name: "M" },
        { id: "p-p1", name: "p1" },
      ]);
      expect(r.durationMinutes).toBe(120);
      expect(r.priority).toBe("p1");
      expect(r.projectId).toBeUndefined();
    });

    it("waits for a terminator like every other token", () => {
      expect(
        extractTitleShortcuts("fix the sink #home", false, PROJECTS).projectId
      ).toBeUndefined();
      expect(
        extractTitleShortcuts("fix the sink #home", true, PROJECTS).projectId
      ).toBe("p-home");
    });
  });
});

describe("classifyShortcutToken", () => {
  const PROJECTS = [
    { id: "p-home", name: "Home" },
    { id: "p-side", name: "Side Project" },
  ];

  it("names a project when the token does", () => {
    expect(classifyShortcutToken("home", PROJECTS)).toEqual({
      kind: "project",
      projectId: "p-home",
    });
    expect(classifyShortcutToken("Side_Project", PROJECTS)).toEqual({
      kind: "project",
      projectId: "p-side",
    });
  });

  it("keeps the size → priority → project → tag precedence", () => {
    const shadowing = [
      { id: "p-m", name: "M" },
      { id: "p-p1", name: "p1" },
    ];
    expect(classifyShortcutToken("m", shadowing)).toEqual({
      kind: "estimate",
      durationMinutes: 120,
    });
    expect(classifyShortcutToken("P1", shadowing)).toEqual({
      kind: "priority",
      priority: "p1",
    });
  });

  it("falls back to a tag, and to a tag for every token with no list", () => {
    expect(classifyShortcutToken("plumbing", PROJECTS)).toEqual({
      kind: "tag",
      tag: "plumbing",
    });
    expect(classifyShortcutToken("home")).toEqual({ kind: "tag", tag: "home" });
  });

  it("keeps the tag exactly as typed, case and all", () => {
    // The title absorber pushes `m[1]`, not the lowercased copy it matches on.
    expect(classifyShortcutToken("Plumbing", PROJECTS)).toEqual({
      kind: "tag",
      tag: "Plumbing",
    });
  });

  it("agrees with the title absorber on the same token", () => {
    // The two run on the same text from different boxes — a "+ tag" field and
    // a title — so a disagreement here is the bug this function exists to end.
    for (const token of ["home", "sideproject", "plumbing", "xs", "p2"]) {
      const viaTitle = extractTitleShortcuts(`t #${token} `, false, PROJECTS);
      const viaToken = classifyShortcutToken(token, PROJECTS);
      switch (viaToken.kind) {
        case "project":
          expect(viaTitle.projectId).toBe(viaToken.projectId);
          break;
        case "estimate":
          expect(viaTitle.durationMinutes).toBe(viaToken.durationMinutes);
          break;
        case "priority":
          expect(viaTitle.priority).toBe(viaToken.priority);
          break;
        default:
          expect(viaTitle.tags).toEqual([viaToken.tag]);
      }
    }
  });
});
