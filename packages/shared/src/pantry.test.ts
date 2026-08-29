import { describe, expect, it } from "vitest";
import type { PantryEntry } from "./pantry.js";
import {
  bandFor,
  cadenceDays,
  cadenceLabel,
  daysSince,
  dueEntries,
  dueState,
  lastBoughtLabel,
  medianGap,
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

describe("medianGap / cadenceDays", () => {
  it("takes the middle, and shrugs off an outlier", () => {
    // Why `gaps` is an array rather than a running average: one holiday month
    // would drag a mean far enough that a weekly item never reads as due again.
    expect(medianGap([7, 6, 8, 7, 60])).toBe(7);
    expect(medianGap([7, 6, 8, 7, 60].map((n) => n))).not.toBe(
      Math.round([7, 6, 8, 7, 60].reduce((a, b) => a + b) / 5)
    );
  });

  it("averages the middle pair for an even count", () => {
    expect(medianGap([6, 8])).toBe(7);
  });

  it("ignores zero and nonsense gaps", () => {
    expect(medianGap([0, 7, 7])).toBe(7);
    expect(medianGap([])).toBeNull();
  });

  it("says nothing until three buys", () => {
    // Two buys is one gap, which proves nothing: salt bought in January and
    // again in March would otherwise announce a two-month rhythm.
    expect(cadenceDays(entry("Salt", 5, { buy_count: 2, gaps: [60] }))).toBeNull();
    expect(
      cadenceDays(entry("Milk", 5, { buy_count: 3, gaps: [7, 7] }))
    ).toBe(7);
  });
});

describe("dueState", () => {
  const rhythm = { buy_count: 6, gaps: [7, 7, 6, 8] };

  it("is unknown without enough history", () => {
    expect(dueState(entry("Salt", 400, { buy_count: 2, gaps: [60] }), NOW)).toBe(
      "unknown"
    );
  });

  it("is stocked inside the rhythm and due once past it", () => {
    expect(dueState(entry("Milk", 3, rhythm), NOW)).toBe("stocked");
    expect(dueState(entry("Milk", 7, rhythm), NOW)).toBe("due");
    expect(dueState(entry("Milk", 12, rhythm), NOW)).toBe("due");
  });

  it("stops calling something due once it has clearly been abandoned", () => {
    // Without the ceiling, every item eventually becomes due and stays that
    // way, and something abandoned years ago would rank first.
    expect(dueState(entry("Milk", 21, rhythm), NOW)).toBe("due");
    expect(dueState(entry("Milk", 22, rhythm), NOW)).toBe("unknown");
  });
});

describe("dueEntries", () => {
  const pantry = [
    // 3 days past a 7-day rhythm → ratio 1.43
    entry("Milk", 10, { buy_count: 9, gaps: [7, 7, 6, 8] }),
    // 5 days past a 90-day rhythm → ratio 1.06
    entry("Rice", 95, { buy_count: 5, gaps: [90, 88, 92] }),
    // well inside its rhythm
    entry("Coffee", 4, { buy_count: 8, gaps: [14, 15, 13] }),
    // no rhythm known
    entry("Sparklers", 300, { buy_count: 1 }),
  ];

  it("offers only what is past its own rhythm", () => {
    expect(dueEntries(pantry, { now: NOW }).map((e) => e.title)).toEqual([
      "Milk",
      "Rice",
    ]);
  });

  it("ranks by how far past the rhythm, not by age", () => {
    // Rice is 95 days old and milk 10, but milk is the one that has run out.
    expect(dueEntries(pantry, { now: NOW })[0].title).toBe("Milk");
  });

  it("leaves out what is already on the list", () => {
    expect(
      dueEntries(pantry, { now: NOW, onList: [{ title: "Milk" }] }).map(
        (e) => e.title
      )
    ).toEqual(["Rice"]);
  });

  it("caps the strip so it never becomes a second list", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      entry(`Item ${i}`, 30, { buy_count: 5, gaps: [7, 7, 7] })
    );
    expect(dueEntries(many, { now: NOW }).length).toBeLessThanOrEqual(6);
  });
});

describe("cadenceLabel", () => {
  it("hedges the wording, since a few trips cannot support a precise claim", () => {
    expect(cadenceLabel(entry("a", 0, { buy_count: 4, gaps: [7, 7, 7] }))).toBe(
      "about weekly"
    );
    expect(cadenceLabel(entry("a", 0, { buy_count: 4, gaps: [30, 30, 30] }))).toBe(
      "about monthly"
    );
    expect(cadenceLabel(entry("a", 0, { buy_count: 4, gaps: [21, 21, 21] }))).toBe(
      "every 3 weeks"
    );
    expect(cadenceLabel(entry("a", 0, { buy_count: 4, gaps: [90, 92, 88] }))).toBe(
      "every 3 months"
    );
    expect(cadenceLabel(entry("a", 0, { buy_count: 4, gaps: [3, 3, 3] }))).toBe(
      "every 3 days"
    );
  });

  it("says nothing when the rhythm is unknown", () => {
    expect(cadenceLabel(entry("a", 0, { buy_count: 1 }))).toBe("");
  });
});

describe("pantryBands exclude", () => {
  it("drops what the due strip has already shown", () => {
    // Excluded from the bands below, so nothing is offered twice on one screen.
    const pantry = [entry("Milk", 3), entry("Rice", 30)];
    const bands = pantryBands(pantry, { now: NOW, exclude: ["milk"] });
    const titles = bands.flatMap((b) => b.entries.map((e) => e.title));
    expect(titles).toEqual(["Rice"]);
  });
});
