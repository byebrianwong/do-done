import { describe, it, expect } from "vitest";
import {
  DEFAULT_PHOSPHOR_WEIGHT,
  PHOSPHOR_CATALOGUE,
  PHOSPHOR_ICONS,
  PHOSPHOR_PATHS,
  PHOSPHOR_WEIGHTS,
  formatPhosphorIcon,
  isPhosphorIcon,
  parseProjectIcon,
  phosphorSvgMarkup,
  projectIconText,
  searchPhosphorIcons,
} from "./phosphor.js";
import { PROJECT_ICON_MAX_LENGTH } from "./constants.js";
import { ProjectSchema } from "./schemas.js";

describe("the catalogue", () => {
  it("has path data for every icon it offers, in all three weights", () => {
    for (const icon of PHOSPHOR_ICONS) {
      const paths = PHOSPHOR_PATHS[icon.name];
      expect(paths, icon.name).toBeDefined();
      expect(paths.bold.length, `${icon.name} bold`).toBeGreaterThan(0);
      expect(paths.fill.length, `${icon.name} fill`).toBeGreaterThan(0);
      expect(paths.duotone.back, `${icon.name} duotone`).toBeTruthy();
      expect(paths.duotone.front.length, `${icon.name} duotone`).toBeGreaterThan(
        0
      );
    }
  });

  it("offers only tokens the column and the schema accept", () => {
    for (const icon of PHOSPHOR_ICONS) {
      for (const weight of PHOSPHOR_WEIGHTS) {
        const token = formatPhosphorIcon(icon.name, weight.id);
        expect(token.length, token).toBeLessThanOrEqual(PROJECT_ICON_MAX_LENGTH);
        expect(ProjectSchema.shape.icon.safeParse(token).success, token).toBe(
          true
        );
      }
    }
  });

  it("names its groups uniquely", () => {
    const ids = PHOSPHOR_CATALOGUE.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The picker drops the group headers the moment a search or a group filter
  // narrows the list, and keys those cells by icon name alone. A name in two
  // groups therefore collides on a React key in exactly the view most people
  // use. Pick one group per icon and use a sibling for the other reading.
  it("lists each icon in exactly one group", () => {
    const names = PHOSPHOR_ICONS.map((i) => i.name);
    const twice = names.filter((n, i) => names.indexOf(n) !== i);
    expect(twice).toEqual([]);
  });

  it("offers the three weights the app names, in app words", () => {
    expect(PHOSPHOR_WEIGHTS.map((w) => [w.id, w.label])).toEqual([
      ["bold", "Outline"],
      ["fill", "Fill"],
      ["duotone", "Light fill"],
    ]);
  });
});

describe("parseProjectIcon", () => {
  it("reads nothing as nothing", () => {
    expect(parseProjectIcon(null).kind).toBe("none");
    expect(parseProjectIcon(undefined).kind).toBe("none");
    expect(parseProjectIcon("").kind).toBe("none");
    expect(parseProjectIcon("   ").kind).toBe("none");
  });

  it("reads a character as an emoji", () => {
    expect(parseProjectIcon("🚀")).toEqual({ kind: "emoji", char: "🚀" });
    expect(parseProjectIcon("★")).toEqual({ kind: "emoji", char: "★" });
  });

  it("reads a token as an icon, with its weight", () => {
    const parsed = parseProjectIcon("ph:briefcase:duotone");
    expect(parsed.kind).toBe("phosphor");
    if (parsed.kind !== "phosphor") return;
    expect(parsed.name).toBe("briefcase");
    expect(parsed.weight).toBe("duotone");
    expect(parsed.paths).toBe(PHOSPHOR_PATHS.briefcase);
  });

  it("round-trips whatever the picker writes", () => {
    for (const weight of PHOSPHOR_WEIGHTS) {
      const parsed = parseProjectIcon(formatPhosphorIcon("house", weight.id));
      expect(parsed.kind).toBe("phosphor");
      if (parsed.kind !== "phosphor") continue;
      expect(parsed.name).toBe("house");
      expect(parsed.weight).toBe(weight.id);
    }
  });

  it("falls back to the default weight when the token has none", () => {
    const parsed = parseProjectIcon("ph:house");
    expect(parsed.kind).toBe("phosphor");
    if (parsed.kind !== "phosphor") return;
    expect(parsed.weight).toBe(DEFAULT_PHOSPHOR_WEIGHT);
  });

  it("falls back to the default weight when the token names a bogus one", () => {
    const parsed = parseProjectIcon("ph:house:sparkly");
    expect(parsed.kind).toBe("phosphor");
    if (parsed.kind !== "phosphor") return;
    expect(parsed.weight).toBe(DEFAULT_PHOSPHOR_WEIGHT);
  });

  it("reports an icon it cannot draw as nothing, never as text", () => {
    // The rule under test: a row that treated this as an emoji would print
    // "ph:not-a-real-icon:fill" inside a 20px ring.
    expect(parseProjectIcon("ph:not-a-real-icon:fill").kind).toBe("none");
    expect(parseProjectIcon("ph:").kind).toBe("none");
    expect(parseProjectIcon("ph:::").kind).toBe("none");
  });

  it("does not mistake a character that merely starts with p-h", () => {
    expect(parseProjectIcon("photo")).toEqual({ kind: "emoji", char: "photo" });
  });
});

describe("isPhosphorIcon", () => {
  it("splits the two kinds", () => {
    expect(isPhosphorIcon("ph:house:fill")).toBe(true);
    expect(isPhosphorIcon("🚀")).toBe(false);
    expect(isPhosphorIcon("")).toBe(false);
    expect(isPhosphorIcon(null)).toBe(false);
  });
});

describe("projectIconText", () => {
  it("gives a string label the emoji and nothing else", () => {
    expect(projectIconText("🚀")).toBe("🚀");
    expect(projectIconText("ph:house:fill")).toBe("");
    expect(projectIconText(null)).toBe("");
  });
});

describe("searchPhosphorIcons", () => {
  it("returns everything for an empty query", () => {
    expect(searchPhosphorIcons("")).toHaveLength(PHOSPHOR_ICONS.length);
  });

  it("matches on label", () => {
    expect(searchPhosphorIcons("briefcase").map((i) => i.name)).toContain(
      "briefcase"
    );
  });

  it("matches on a keyword the label does not carry", () => {
    expect(searchPhosphorIcons("groceries").map((i) => i.name)).toContain(
      "shopping-cart"
    );
  });

  it("matches on the icon's own name", () => {
    expect(searchPhosphorIcons("potted").map((i) => i.name)).toContain(
      "potted-plant"
    );
  });

  it("finds nothing for a query that matches nothing", () => {
    expect(searchPhosphorIcons("zzzznotathing")).toHaveLength(0);
  });
});

describe("phosphorSvgMarkup", () => {
  const paths = PHOSPHOR_PATHS.house;

  it("draws a solid weight as plain paths in the given colour", () => {
    const svg = phosphorSvgMarkup(paths, "fill", "#6366f1", 12);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg).toContain('fill="#6366f1"');
    expect(svg).toContain('width="12"');
    expect(svg).not.toContain("opacity");
  });

  it("draws duotone as a faded layer behind the line work", () => {
    const svg = phosphorSvgMarkup(paths, "duotone", "#6366f1", 12);
    expect(svg).toContain('opacity="0.2"');
    // The faded layer is first, or it would cover the line work.
    expect(svg.indexOf('opacity="0.2"')).toBeLessThan(
      svg.lastIndexOf("<path")
    );
  });

  it("closes every element it opens", () => {
    for (const weight of PHOSPHOR_WEIGHTS) {
      const svg = phosphorSvgMarkup(paths, weight.id, "#000000", 9);
      expect(svg.endsWith("</svg>"), weight.id).toBe(true);
      const opens = svg.match(/<path/g)?.length ?? 0;
      const closes = svg.match(/\/>/g)?.length ?? 0;
      expect(closes, weight.id).toBe(opens);
    }
  });
});
