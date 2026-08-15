import { describe, it, expect } from "vitest";
import {
  AISLES,
  AISLE_GROUP_MIN_ITEMS,
  AISLE_LABEL,
  aisleOptions,
  aisleOverride,
  aisleTag,
  categorizeItem,
  groupByAisle,
  isAisle,
  itemAisle,
  withAisle,
  type Aisle,
} from "./food.js";

const item = (title: string, tags: string[] = []) => ({ title, tags });

describe("categorizeItem", () => {
  it("knows the everyday things people write", () => {
    const cases: Array<[string, Aisle]> = [
      ["Bananas", "produce"],
      ["Whole milk", "dairy"],
      ["Sourdough", "bakery"],
      ["Chicken", "meat"],
      ["Ice cream", "frozen"],
      ["Olive oil", "pantry"],
      ["Crisps", "snacks"],
      ["Orange juice", "drinks"],
      ["Toilet paper", "household"],
      ["Toothpaste", "personal"],
      ["Nappies", "baby"],
      ["Cat food", "pets"],
    ];
    for (const [title, aisle] of cases) {
      expect(categorizeItem(title), title).toBe(aisle);
    }
  });

  it("ignores quantities, brands and adjectives around the noun", () => {
    expect(categorizeItem("2% milk")).toBe("dairy");
    expect(categorizeItem("6 large free-range eggs")).toBe("dairy");
    expect(categorizeItem("organic baby spinach")).toBe("produce");
    expect(categorizeItem("Tin of chopped tomatoes")).toBe("pantry");
  });

  it("prefers the longest phrase over any word inside it", () => {
    // "cream" is dairy; the item is not.
    expect(categorizeItem("ice cream")).toBe("frozen");
    // "chicken" is meat; "chicken stock" is not.
    expect(categorizeItem("chicken stock")).toBe("pantry");
    // Both words are in the lexicon separately, in different aisles.
    expect(categorizeItem("coffee beans")).toBe("pantry");
    expect(categorizeItem("frozen peas")).toBe("frozen");
  });

  it("takes the rightmost of two equal-length matches", () => {
    // The head-final rule. English noun compounds name the thing last, so this
    // one pair has to come out opposite ways round — and nothing about
    // first-match scanning could do it.
    expect(categorizeItem("chocolate milk")).toBe("dairy");
    expect(categorizeItem("milk chocolate")).toBe("snacks");
  });

  it("singularises a word it doesn't know as written", () => {
    // "carrot" is listed, "carrots" happens to be too; "avocadoes" is not.
    expect(categorizeItem("carrots")).toBe("produce");
    expect(categorizeItem("shallots")).toBe("produce");
    expect(categorizeItem("baguettes")).toBe("bakery");
  });

  it("pluralises too, since the lexicon isn't written consistently", () => {
    // "candles" is listed plural (you buy several), "sourdough" singular (you
    // buy a loaf) — a match has to survive the user writing the other one.
    expect(categorizeItem("Scented candle")).toBe("household");
    expect(categorizeItem("A biscuit")).toBe("snacks");
    expect(categorizeItem("Tortillas")).toBe("bakery");
  });

  it("does not inflect a short word into a false match", () => {
    // Guards the rule from turning three-letter noise into a hit.
    expect(categorizeItem("abs")).toBeNull();
    expect(categorizeItem("xyz")).toBeNull();
  });

  it("keeps ambiguous bare words out of the lexicon entirely", () => {
    // Found by running it: "wrap" was listed under bakery for tortilla wraps,
    // and put "Gift wrap" in the Bakery aisle. A single-word entry has to be
    // unambiguous across aisles to earn its place.
    expect(categorizeItem("Gift wrap")).toBe("household");
    expect(categorizeItem("Cling wrap")).toBe("household");
    // The thing it was there for is still reachable by its own name.
    expect(categorizeItem("Tortilla")).toBe("bakery");
  });

  it("lets a two-word entry beat a one-word entry from another aisle", () => {
    // The general shape of the fix above, and why the lexicon can carry
    // ambiguous words at all as long as the specific phrase is listed too.
    expect(categorizeItem("Toilet roll")).toBe("household");
    expect(categorizeItem("Bread rolls")).toBe("bakery");
    expect(categorizeItem("Frozen chips")).toBe("frozen");
    expect(categorizeItem("Black pepper")).toBe("pantry");
    expect(categorizeItem("Bell pepper")).toBe("produce");
    expect(categorizeItem("Dish soap")).toBe("household");
    expect(categorizeItem("Hand soap")).toBe("personal");
  });

  it("returns null for anything it doesn't recognise", () => {
    // A first-class state, not a failure — the honest limit of a lexicon.
    expect(categorizeItem("Birthday card")).toBeNull();
    expect(categorizeItem("USB-C cable, 2m")).toBeNull();
    expect(categorizeItem("")).toBeNull();
    expect(categorizeItem("🛒")).toBeNull();
  });
});

describe("aisle overrides", () => {
  it("reads a prefixed tag and ignores ordinary ones", () => {
    expect(aisleOverride({ tags: ["urgent", aisleTag("frozen")] })).toBe("frozen");
    expect(aisleOverride({ tags: ["urgent", "frozen"] })).toBeNull();
    expect(aisleOverride({ tags: [] })).toBeNull();
  });

  it("rejects a value that isn't an aisle", () => {
    // Tags are free text and reach us from MCP and the editor too.
    expect(aisleOverride({ tags: ["aisle:nonsense"] })).toBeNull();
    expect(isAisle("nonsense")).toBe(false);
    expect(isAisle("produce")).toBe(true);
  });

  it("beats the guess, with no confidence that could overturn it", () => {
    // The lexicon guesses about language; the user is looking at the shelf.
    expect(itemAisle(item("Bananas"))).toBe("produce");
    expect(itemAisle(item("Bananas", [aisleTag("frozen")]))).toBe("frozen");
  });

  it("keeps every other tag when set, replaced and cleared", () => {
    const withStore = ["at:Costco", "urgent"];
    const set = withAisle(withStore, "dairy");
    expect(set).toEqual(["at:Costco", "urgent", aisleTag("dairy")]);
    expect(withAisle(set, "frozen")).toEqual([
      "at:Costco",
      "urgent",
      aisleTag("frozen"),
    ]);
    expect(withAisle(set, null)).toEqual(["at:Costco", "urgent"]);
  });
});

describe("groupByAisle", () => {
  const bigList = [
    item("Bananas"),
    item("Spinach"),
    item("Whole milk"),
    item("Greek yoghurt"),
    item("Sourdough"),
    item("Chicken"),
    item("Ice cream"),
    item("Birthday card"),
  ];

  it("orders groups as the shop is walked, not alphabetically", () => {
    const groups = groupByAisle(bigList);
    expect(groups.map((g) => g.aisle)).toEqual([
      "produce",
      "bakery",
      "meat",
      "dairy",
      "frozen",
      null,
    ]);
  });

  it("puts what it doesn't know in a trailing group called Other", () => {
    const groups = groupByAisle(bigList);
    const last = groups[groups.length - 1]!;
    expect(last.aisle).toBeNull();
    // Not "Uncategorised": the user didn't fail to do anything, we did.
    expect(last.label).toBe("Other");
    expect(last.items.map((i) => i.title)).toEqual(["Birthday card"]);
  });

  it("never loses or duplicates an item", () => {
    const groups = groupByAisle(bigList);
    const titles = groups.flatMap((g) => g.items.map((i) => i.title)).sort();
    expect(titles).toEqual(bigList.map((i) => i.title).sort());
  });

  it("stays flat below the threshold", () => {
    // Three headers over five rows is furniture, not a list.
    const few = bigList.slice(0, AISLE_GROUP_MIN_ITEMS - 1);
    const groups = groupByAisle(few);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.aisle).toBeNull();
    expect(groups[0]!.label).toBe("");
    expect(groups[0]!.items).toHaveLength(few.length);
  });

  it("stays flat when everything lands in one aisle", () => {
    const allProduce = [
      item("Bananas"), item("Spinach"), item("Carrots"),
      item("Tomatoes"), item("Onions"), item("Lemons"), item("Kale"),
    ];
    expect(groupByAisle(allProduce)).toHaveLength(1);
  });

  it("stays flat when it recognises nothing at all", () => {
    // The failure mode that matters: an unrecognised list has to look like the
    // plain list it always was, not like a broken grouped one.
    const unknown = Array.from({ length: 8 }, (_, i) => item(`Widget ${i}`));
    const groups = groupByAisle(unknown);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("");
  });

  it("honours per-item corrections when grouping", () => {
    const groups = groupByAisle([
      ...bigList.slice(0, 5),
      item("Bananas", [aisleTag("frozen")]),
      item("Chicken"),
      item("Ice cream"),
    ]);
    const frozen = groups.find((g) => g.aisle === "frozen")!;
    expect(frozen.items.map((i) => i.title)).toContain("Bananas");
  });

  it("respects a caller-supplied threshold", () => {
    const two = [item("Bananas"), item("Whole milk")];
    expect(groupByAisle(two, { minItems: 2 })).toHaveLength(2);
  });
});

describe("aisleOptions", () => {
  it("offers every aisle, in walking order, with a label each", () => {
    const options = aisleOptions();
    expect(options.map((o) => o.value)).toEqual([...AISLES]);
    for (const option of options) {
      expect(option.label).toBe(AISLE_LABEL[option.value]);
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});
