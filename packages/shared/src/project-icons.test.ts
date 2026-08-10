import { describe, it, expect } from "vitest";
import {
  PROJECT_ICONS,
  PROJECT_ICON_GROUPS,
  PROJECT_EMOJI_MAX_LENGTH,
  firstGrapheme,
  normalizeProjectIcon,
  searchProjectIcons,
} from "./project-icons.js";
import { ProjectSchema } from "./schemas.js";

describe("the catalogue", () => {
  it("offers nothing the column or the schema would reject", () => {
    for (const icon of PROJECT_ICONS) {
      // JS length is what `z.string().max(10)` measures…
      expect(icon.char.length, icon.name).toBeLessThanOrEqual(
        PROJECT_EMOJI_MAX_LENGTH
      );
      // …and code points are what Postgres' char_length() measures.
      expect(Array.from(icon.char).length, icon.name).toBeLessThanOrEqual(
        PROJECT_EMOJI_MAX_LENGTH
      );
    }
  });

  it("offers only single glyphs", () => {
    for (const icon of PROJECT_ICONS) {
      expect(firstGrapheme(icon.char), icon.name).toBe(icon.char);
    }
  });

  it("lists each character once", () => {
    const chars = PROJECT_ICONS.map((i) => i.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it("passes the project schema's icon field", () => {
    for (const icon of PROJECT_ICONS) {
      const parsed = ProjectSchema.shape.icon.safeParse(icon.char);
      expect(parsed.success, icon.name).toBe(true);
    }
  });

  it("has a stable group id for every group", () => {
    const ids = PROJECT_ICON_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("symbols");
  });
});

describe("firstGrapheme", () => {
  it("returns nothing for empty input", () => {
    expect(firstGrapheme("")).toBe("");
  });

  it("takes one plain character", () => {
    expect(firstGrapheme("abc")).toBe("a");
    expect(firstGrapheme("★ favourite")).toBe("★");
  });

  it("keeps a surrogate pair together", () => {
    expect(firstGrapheme("🚀 launch day")).toBe("🚀");
  });

  it("keeps a variation selector with its base", () => {
    expect(firstGrapheme("✈️ trip")).toBe("✈️");
  });

  it("keeps a skin tone with its base", () => {
    expect(firstGrapheme("👍🏽 nice")).toBe("👍🏽");
  });

  it("keeps a keycap together", () => {
    expect(firstGrapheme("1️⃣ first")).toBe("1️⃣");
  });

  it("keeps both halves of a flag, and no more", () => {
    expect(firstGrapheme("🇬🇧🇫🇷")).toBe("🇬🇧");
  });

  it("keeps a ZWJ sequence together", () => {
    expect(firstGrapheme("👩‍💻 coding")).toBe("👩‍💻");
  });

  it("does not swallow a trailing joiner with nothing after it", () => {
    expect(firstGrapheme("👍‍")).toBe("👍");
  });
});

describe("normalizeProjectIcon", () => {
  it("reduces a sentence to its first glyph", () => {
    expect(normalizeProjectIcon("🏠 house stuff")).toBe("🏠");
    expect(normalizeProjectIcon("  ★ ")).toBe("★");
  });

  it("is empty for empty input", () => {
    expect(normalizeProjectIcon("")).toBe("");
    expect(normalizeProjectIcon("   ")).toBe("");
  });

  it("drops a cluster too long to store rather than cutting it in half", () => {
    // 4 people + 3 joiners = 11 UTF-16 units; truncating would render as two
    // unrelated people instead of a family.
    expect(normalizeProjectIcon("👨‍👩‍👧‍👦")).toBe("");
  });

  it("always returns something the schema accepts", () => {
    for (const input of ["🚀🚀🚀", "hello world", "👩‍💻", "👨‍👩‍👧‍👦", "🇬🇧"]) {
      const icon = normalizeProjectIcon(input);
      if (icon === "") continue;
      expect(ProjectSchema.shape.icon.safeParse(icon).success).toBe(true);
    }
  });
});

describe("searchProjectIcons", () => {
  it("returns everything for an empty query", () => {
    expect(searchProjectIcons("")).toHaveLength(PROJECT_ICONS.length);
  });

  it("matches on name", () => {
    const chars = searchProjectIcons("briefcase").map((i) => i.char);
    expect(chars).toContain("💼");
  });

  it("matches on a keyword the name does not carry", () => {
    const chars = searchProjectIcons("groceries").map((i) => i.char);
    expect(chars).toContain("🛒");
  });

  it("offers a pasted glyph the catalogue does not stock", () => {
    const results = searchProjectIcons("🦄");
    expect(results[0]?.char).toBe("🦄");
  });

  it("does not duplicate a pasted glyph it already stocks", () => {
    const results = searchProjectIcons("🚀");
    expect(results.filter((i) => i.char === "🚀")).toHaveLength(1);
  });

  it("finds nothing for a query that matches nothing", () => {
    expect(searchProjectIcons("zzzznotathing")).toHaveLength(0);
  });
});
