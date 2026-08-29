import { describe, expect, it } from "vitest";
import type { PantryEntry } from "./pantry.js";
import {
  bandFor,
  daysSince,
  lastBoughtLabel,
  pantryBands,
  searchPantry,
} from "./pantry.js";

const NOW = new Date(2026, 7, 29, 10, 0); // Sat 29 Aug 2026, local

/** An entry last bought `days` ago. */
function entry(
  title: string,
  days: number,
  over: Partial<PantryEntry> = {}
): PantryEntry {
  const at = new Date(NOW);
  at.setDate(at.getDate() - days);
  return {
    term: title.toLowerCase(),
    title,
    last_bought_at: at.toISOString(),
    buy_count: 1,
    gaps: [],
    store: null,
    ...over,
  };
}

describe("daysSince / bandFor", () => {
  it("counts whole days, never negative", () => {
    expect(daysSince(entry("Milk", 6).last_bought_at, NOW)).toBe(6);
    // A clock skew that dates a buy in the future gives 0, not a negative.
    const future = new Date(NOW);
    future.setDate(future.getDate() + 3);
    expect(daysSince(future.toISOString(), NOW)).toBe(0);
  });

  it("puts the boundaries in the nearer band", () => {
    expect(bandFor(entry("Milk", 14), NOW)).toBe("recent");
    expect(bandFor(entry("Rice", 15), NOW)).toBe("mid");
    expect(bandFor(entry("Foil", 62), NOW)).toBe("mid");
    expect(bandFor(entry("Vanilla", 63), NOW)).toBe("earlier");
  });
});

describe("pantryBands", () => {
  const pantry = [
    entry("Milk", 6),
    entry("Sourdough", 9),
    entry("Rice", 35),
    entry("Olive oil", 120),
    entry("Vanilla", 300),
  ];

  it("splits into the three bands, newest first inside each", () => {
    const bands = pantryBands(pantry, { now: NOW });
    expect(bands.map((b) => b.key)).toEqual(["recent", "mid", "earlier"]);
    expect(bands[0].entries.map((e) => e.title)).toEqual(["Milk", "Sourdough"]);
    expect(bands[2].entries.map((e) => e.title)).toEqual([
      "Olive oil",
      "Vanilla",
    ]);
  });

  it("drops empty bands rather than printing a zero", () => {
    const bands = pantryBands([entry("Milk", 2)], { now: NOW });
    expect(bands).toHaveLength(1);
    expect(bands[0].key).toBe("recent");
  });

  it("hides anything already on the list", () => {
    // Stops the drawer duplicating the list. An item is recorded the moment it
    // is ticked, so without this it would sit in the cart and the drawer at
    // once, offering to add something already on screen.
    const bands = pantryBands(pantry, {
      now: NOW,
      onList: [{ title: "Milk" }, { title: "2 Rice" }],
    });
    const titles = bands.flatMap((b) => b.entries.map((e) => e.title));
    expect(titles).not.toContain("Milk");
    // Matched on the normalised term, so a quantity prefix does not slip past.
    expect(titles).not.toContain("Rice");
    expect(titles).toContain("Sourdough");
  });

  it("is empty when everything is already on the list", () => {
    expect(
      pantryBands([entry("Milk", 3)], { now: NOW, onList: [{ title: "milk" }] })
    ).toEqual([]);
  });
});

describe("lastBoughtLabel", () => {
  it("scales the unit to the age", () => {
    expect(lastBoughtLabel(entry("a", 0).last_bought_at, NOW)).toBe("today");
    expect(lastBoughtLabel(entry("a", 1).last_bought_at, NOW)).toBe("yesterday");
    expect(lastBoughtLabel(entry("a", 6).last_bought_at, NOW)).toBe("6d ago");
    expect(lastBoughtLabel(entry("a", 35).last_bought_at, NOW)).toBe("5w ago");
    expect(lastBoughtLabel(entry("a", 210).last_bought_at, NOW)).toBe("7mo ago");
    expect(lastBoughtLabel(entry("a", 800).last_bought_at, NOW)).toBe("2y ago");
  });
});

describe("searchPantry", () => {
  const pantry = [
    entry("Green beans", 40, { buy_count: 2 }),
    entry("Greek yogurt", 6, { buy_count: 9, store: "Trader Joe's" }),
    entry("Green curry paste", 210, { buy_count: 1 }),
    entry("Frozen peas", 20, { buy_count: 3 }),
  ];

  it("says nothing until something is typed", () => {
    expect(searchPantry(pantry, "  ")).toEqual([]);
  });

  it("ranks the staple above the thing bought once", () => {
    const hits = searchPantry(pantry, "gre").map((e) => e.title);
    expect(hits).toEqual([
      "Greek yogurt",
      "Green beans",
      "Green curry paste",
    ]);
  });

  it("prefers a word start over a match buried mid-word", () => {
    // "peas" starts a word in "Frozen peas"; "eas" only appears inside one.
    expect(searchPantry(pantry, "peas").map((e) => e.title)).toEqual([
      "Frozen peas",
    ]);
    expect(searchPantry(pantry, "eas").map((e) => e.title)).toEqual([
      "Frozen peas",
    ]);
  });

  it("leaves out what is already on the list", () => {
    const hits = searchPantry(pantry, "gre", {
      onList: [{ title: "Greek yogurt" }],
    });
    expect(hits.map((e) => e.title)).not.toContain("Greek yogurt");
  });

  it("carries the store back with the suggestion", () => {
    expect(searchPantry(pantry, "greek")[0].store).toBe("Trader Joe's");
  });

  it("treats a regex-ish query as text", () => {
    expect(() => searchPantry(pantry, "gre(")).not.toThrow();
  });
});
