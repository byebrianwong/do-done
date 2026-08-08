import { describe, it, expect } from "vitest";
import { matchProject, projectMatchKey } from "./project-match.js";

const PROJECTS = [
  { id: "p-home", name: "Home" },
  { id: "p-side", name: "Side Project" },
  { id: "p-emoji", name: "🏠" },
];

describe("projectMatchKey", () => {
  it("lowercases and drops everything a #token can't carry", () => {
    expect(projectMatchKey("Side Project")).toBe("sideproject");
    expect(projectMatchKey("Side-Project!")).toBe("sideproject");
    expect(projectMatchKey("🏠 Home")).toBe("home");
  });
});

describe("matchProject", () => {
  it("matches ignoring case, spaces and punctuation", () => {
    expect(matchProject("home", PROJECTS)?.id).toBe("p-home");
    expect(matchProject("HOME", PROJECTS)?.id).toBe("p-home");
    expect(matchProject("side_project", PROJECTS)?.id).toBe("p-side");
  });

  it("returns undefined for a token naming nothing", () => {
    expect(matchProject("plumbing", PROJECTS)).toBeUndefined();
  });

  it("returns undefined with no list at all", () => {
    expect(matchProject("home", undefined)).toBeUndefined();
    expect(matchProject("home", [])).toBeUndefined();
  });

  it("never matches a name that normalises to nothing", () => {
    // "🏠" keys to "" — otherwise every unmatched token would find it.
    expect(matchProject("anything", PROJECTS)).toBeUndefined();
    expect(matchProject("", PROJECTS)).toBeUndefined();
  });

  it("takes the first of two names that normalise the same", () => {
    const dupes = [
      { id: "first", name: "Work" },
      { id: "second", name: "work!" },
    ];
    expect(matchProject("work", dupes)?.id).toBe("first");
  });
});
