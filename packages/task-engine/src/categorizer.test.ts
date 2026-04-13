import { describe, it, expect } from "vitest";
import { suggestCategories, suggestTags } from "./categorizer.js";

describe("suggestCategories", () => {
  it('suggests "groceries" for "buy groceries at store"', () => {
    const categories = suggestCategories("buy groceries at store");
    expect(categories).toContain("groceries");
  });

  it('suggests "health" for "gym workout"', () => {
    const categories = suggestCategories("gym workout");
    expect(categories).toContain("health");
  });

  it('suggests "work" for work-related input', () => {
    const categories = suggestCategories("prepare presentation for client");
    expect(categories).toContain("work");
  });

  it("returns empty array for unrecognized input", () => {
    const categories = suggestCategories("something random xyz");
    expect(categories).toEqual([]);
  });
});

describe("suggestTags", () => {
  it('returns "urgent" for "urgent deploy fix"', () => {
    const tags = suggestTags("urgent deploy fix");
    expect(tags).toContain("urgent");
  });

  it('returns "quick" for quick tasks', () => {
    const tags = suggestTags("quick 5 min review");
    expect(tags).toContain("quick");
  });

  it('returns "waiting" for blocked tasks', () => {
    const tags = suggestTags("waiting on approval");
    expect(tags).toContain("waiting");
  });

  it("returns empty array when no tag patterns match", () => {
    const tags = suggestTags("normal task");
    expect(tags).toEqual([]);
  });
});
