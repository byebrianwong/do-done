import { describe, it, expect } from "vitest";
import type { Project, Task } from "./schemas.js";
import { isListProject, projectKind } from "./schemas.js";
import {
  STORE_TAG_PREFIX,
  addStoreHint,
  applyStoreToken,
  extractStoreTokens,
  gotItems,
  isGot,
  itemSubline,
  listSubline,
  normalizeStore,
  openItems,
  orderForShop,
  sameStore,
  splitProjects,
  removeStoreHint,
  storeHints,
  storeLabel,
  storeSuggestions,
  storeTag,
  storesOnList,
  storesTyped,
  toggleStoreHint,
  typingStoreToken,
  summarizeList,
  withStoreHints,
} from "./lists.js";

function item(
  title: string,
  extra: Partial<Pick<Task, "status" | "tags">> = {}
): Pick<Task, "status" | "tags"> & { title: string } {
  return { title, status: "inbox", tags: [], ...extra };
}

describe("projectKind", () => {
  it("defaults an absent kind to tasks, never to list", () => {
    // A deploy that lands ahead of its migration reads projects with no
    // `kind`. Defaulting the other way would hide a whole project's tasks.
    expect(projectKind({ kind: undefined })).toBe("tasks");
    expect(projectKind(null)).toBe("tasks");
    expect(isListProject({ kind: undefined })).toBe(false);
  });

  it("reads an explicit kind", () => {
    expect(projectKind({ kind: "list" })).toBe("list");
    expect(isListProject({ kind: "list" })).toBe(true);
    expect(isListProject({ kind: "tasks" })).toBe(false);
  });
});

describe("isGot", () => {
  it("treats both terminal statuses as bought", () => {
    expect(isGot({ status: "done" })).toBe(true);
    expect(isGot({ status: "cancelled" })).toBe(true);
  });

  it("leaves every live status on the list", () => {
    for (const status of ["inbox", "later", "not_started", "next", "in_progress"] as const) {
      expect(isGot({ status })).toBe(false);
    }
  });
});

describe("openItems / gotItems", () => {
  const items = [item("Milk"), item("Eggs", { status: "done" }), item("Bread")];

  it("partitions without dropping anything", () => {
    expect(openItems(items).map((i) => i.title)).toEqual(["Milk", "Bread"]);
    expect(gotItems(items).map((i) => i.title)).toEqual(["Eggs"]);
    expect(openItems(items).length + gotItems(items).length).toBe(items.length);
  });
});

describe("storeHints", () => {
  it("reads the prefixed tags and ignores everything else", () => {
    expect(storeHints({ tags: ["urgent", `${STORE_TAG_PREFIX}Costco`] })).toEqual([
      "Costco",
    ]);
    expect(storeHints({ tags: ["urgent", "costco"] })).toEqual([]);
    expect(storeHints({ tags: [] })).toEqual([]);
  });

  it("keeps every shop named, in the order they were tagged", () => {
    // An item can be sold in more than one place, and naming both is what
    // keeps it in front of you whichever shop you end up in.
    expect(
      storeHints({
        tags: [`${STORE_TAG_PREFIX}Costco`, `${STORE_TAG_PREFIX}Safeway`],
      })
    ).toEqual(["Costco", "Safeway"]);
  });

  it("counts two spellings of one shop once", () => {
    // Typed in the composer and again at the shelf. The first spelling wins,
    // because that is the one already on screen.
    expect(
      storeHints({
        tags: [`${STORE_TAG_PREFIX}Trader Joe's`, `${STORE_TAG_PREFIX}trader joes`],
      })
    ).toEqual(["Trader Joe's"]);
  });

  it("ignores a bare prefix with no store after it", () => {
    expect(storeHints({ tags: [STORE_TAG_PREFIX] })).toEqual([]);
    expect(storeHints({ tags: [`${STORE_TAG_PREFIX}   `] })).toEqual([]);
  });
});

describe("withStoreHints / addStoreHint / removeStoreHint / toggleStoreHint", () => {
  it("keeps the item's other tags", () => {
    expect(withStoreHints(["urgent", "bulk"], ["Costco"])).toEqual([
      "urgent",
      "bulk",
      storeTag("Costco"),
    ]);
  });

  it("replaces the whole set rather than adding to it", () => {
    const once = withStoreHints([], ["Costco"]);
    expect(withStoreHints(once, ["Safeway"])).toEqual([storeTag("Safeway")]);
  });

  it("clears the hints when given none", () => {
    const tagged = withStoreHints(["urgent"], ["Costco"]);
    expect(withStoreHints(tagged, [])).toEqual(["urgent"]);
    expect(withStoreHints(tagged, ["   "])).toEqual(["urgent"]);
  });

  it("adds a second shop beside the first", () => {
    const one = addStoreHint([], "Target");
    expect(storeHints({ tags: addStoreHint(one, "Costco") })).toEqual([
      "Target",
      "Costco",
    ]);
  });

  it("does not add a shop the item already has, however it is spelled", () => {
    const tags = addStoreHint([], "Trader Joe's");
    expect(addStoreHint(tags, "trader joes")).toEqual(tags);
  });

  it("removes one shop and leaves the rest", () => {
    const tags = addStoreHint(addStoreHint(["urgent"], "Target"), "Costco");
    expect(removeStoreHint(tags, "target")).toEqual(["urgent", storeTag("Costco")]);
  });

  it("toggles a shop off and on again", () => {
    const on = toggleStoreHint([], "Target");
    expect(storeHints({ tags: on })).toEqual(["Target"]);
    const off = toggleStoreHint(on, "Target");
    expect(storeHints({ tags: off })).toEqual([]);
  });
});

describe("storeLabel", () => {
  it("names one shop plainly and joins the rest with 'or'", () => {
    expect(storeLabel([])).toBe("");
    expect(storeLabel(["Target"])).toBe("Target");
    expect(storeLabel(["Target", "Costco"])).toBe("Target or Costco");
    expect(storeLabel(["Target", "Costco", "Aldi"])).toBe(
      "Target, Costco or Aldi"
    );
  });
});

describe("sameStore", () => {
  it("matches across punctuation, case and spacing", () => {
    // The hint is typed by a person; the shop name comes from OpenStreetMap.
    expect(sameStore("trader joes", "Trader Joe's")).toBe(true);
    expect(sameStore("Whole Foods", "wholefoods")).toBe(true);
  });

  it("matches when one side carries a branch or suffix", () => {
    expect(sameStore("Trader Joe's", "Trader Joe's #142")).toBe(true);
    expect(sameStore("Safeway", "Safeway Bryant St")).toBe(true);
  });

  it("does not match different shops", () => {
    expect(sameStore("Costco", "Safeway")).toBe(false);
  });

  it("never matches on an empty key", () => {
    // A name that normalises to nothing must match nothing, not everything —
    // the same trap `matchProject` has with an emoji-only project name.
    expect(sameStore("🛒", "Costco")).toBe(false);
    expect(sameStore("", "")).toBe(false);
    expect(normalizeStore("🛒")).toBe("");
  });
});

describe("orderForShop", () => {
  const list = [
    item("Milk"),
    item("Sourdough", { tags: [storeTag("Trader Joe's")] }),
    item("Olive oil", { tags: [storeTag("Costco")] }),
    item("Parmesan", { tags: [storeTag("Whole Foods")] }),
    item("Eggs", { status: "done" }),
  ];

  it("puts unhinted items and this shop's items together", () => {
    const { here } = orderForShop(list, "Whole Foods");
    expect(here.map((i) => i.title)).toEqual(["Milk", "Parmesan"]);
  });

  it("keeps an item in front of you at any shop it names", () => {
    // The reason an item may name several. Under one hint per item, milk
    // hinted at Trader Joe's sank into "Better elsewhere" while you stood in
    // Target, which also sells milk.
    const both = [
      item("Milk", { tags: [storeTag("Target"), storeTag("Trader Joe's")] }),
    ];
    expect(orderForShop(both, "Target").here).toHaveLength(1);
    expect(orderForShop(both, "Trader Joe's").here).toHaveLength(1);
    expect(orderForShop(both, "Costco").elsewhere).toHaveLength(1);
  });

  it("sinks other shops' items but never drops them", () => {
    const { here, elsewhere, got } = orderForShop(list, "Whole Foods");
    expect(elsewhere.map((i) => i.title)).toEqual(["Sourdough", "Olive oil"]);
    // Nothing may go missing: a hint is a preference, not a filter.
    expect(here.length + elsewhere.length + got.length).toBe(list.length);
  });

  it("treats every open item as here when the shop is unknown", () => {
    // The ordinary case — no location permission, no geofence, not set up.
    // The feature has to degrade to a plain list rather than to an empty one.
    const { here, elsewhere } = orderForShop(list, null);
    expect(here.map((i) => i.title)).toEqual([
      "Milk",
      "Sourdough",
      "Olive oil",
      "Parmesan",
    ]);
    expect(elsewhere).toEqual([]);
  });

  it("keeps bought items out of both live groups", () => {
    const { here, elsewhere, got } = orderForShop(list, "Costco");
    expect(got.map((i) => i.title)).toEqual(["Eggs"]);
    expect([...here, ...elsewhere].some((i) => i.title === "Eggs")).toBe(false);
  });
});

describe("storesOnList", () => {
  it("orders by use then alphabetically", () => {
    const items = [
      item("a", { tags: [storeTag("Costco")] }),
      item("b", { tags: [storeTag("Safeway")] }),
      item("c", { tags: [storeTag("Costco")] }),
      item("d", { tags: [storeTag("Aldi")] }),
      item("e"),
    ];
    expect(storesOnList(items)).toEqual(["Costco", "Aldi", "Safeway"]);
  });

  it("counts an item at two shops once for each", () => {
    // Otherwise a shop only ever used as a second choice never reaches the
    // suggestions, and the composer cannot offer what the list already uses.
    const items = [
      item("a", { tags: [storeTag("Costco"), storeTag("Aldi")] }),
      item("b", { tags: [storeTag("Aldi")] }),
    ];
    expect(storesOnList(items)).toEqual(["Aldi", "Costco"]);
  });
});

describe("summarizeList / listSubline", () => {
  it("counts open work without regard to where it is", () => {
    const items = [
      item("Milk"),
      item("Olive oil", { tags: [storeTag("Costco")] }),
      item("Eggs", { status: "done" }),
    ];
    expect(summarizeList(items, "Whole Foods")).toEqual({
      open: 2,
      got: 1,
      elsewhere: 1,
    });
  });

  it("says an empty list is empty rather than printing a zero", () => {
    expect(listSubline({ open: 0, got: 0, elsewhere: 0 })).toBe("Nothing on it");
  });

  it("singularises one item", () => {
    expect(listSubline({ open: 1, got: 0, elsewhere: 0 })).toBe("1 item");
  });

  it("mentions the cart only when something is in it", () => {
    expect(listSubline({ open: 8, got: 0, elsewhere: 0 })).toBe("8 items");
    expect(listSubline({ open: 8, got: 3, elsewhere: 0 })).toBe("8 items · 3 in the cart");
  });

  it("still says the list is empty while the cart is full", () => {
    // The end of a shop: everything ticked, nothing cleared yet.
    expect(listSubline({ open: 0, got: 5, elsewhere: 0 })).toBe(
      "Nothing on it · 5 in the cart"
    );
  });
});

describe("extractStoreTokens", () => {
  it("reads a store off the end of the line", () => {
    expect(extractStoreTokens("milk @Trader Joe's")).toEqual({
      title: "milk",
      stores: ["Trader Joe's"],
    });
  });

  it("keeps multi-word stores whole", () => {
    // Why the run reaches end-of-line. A `\S+` token would give a store
    // called "Whole" and an item called "milk Foods".
    expect(extractStoreTokens("oat milk @Whole Foods").stores).toEqual([
      "Whole Foods",
    ]);
  });

  it("reads several shops off one line", () => {
    // ` @` is what separates them, so each may still contain spaces.
    expect(extractStoreTokens("milk @Target @Trader Joe's")).toEqual({
      title: "milk",
      stores: ["Target", "Trader Joe's"],
    });
  });

  it("leaves an item with no token alone", () => {
    expect(extractStoreTokens("  bananas  ")).toEqual({
      title: "bananas",
      stores: [],
    });
  });

  it("does not read an email address as a store", () => {
    // The @ has to open the line or follow a space.
    expect(extractStoreTokens("ask matt@example.com about the cake")).toEqual({
      title: "ask matt@example.com about the cake",
      stores: [],
    });
  });

  it("ignores a half-typed token", () => {
    // Mid-keystroke, before any store has been named.
    expect(extractStoreTokens("milk @").stores).toEqual([]);
    expect(extractStoreTokens("milk @Target @").stores).toEqual(["Target"]);
  });

  it("survives a token with no item name", () => {
    // The composer rejects an empty title; the parser just reports one.
    expect(extractStoreTokens("@Target")).toEqual({
      title: "",
      stores: ["Target"],
    });
  });
});

describe("typingStoreToken / storesTyped / applyStoreToken", () => {
  it("reports an empty query for a bare @, where the extractor reports none", () => {
    // The two answer different questions: what is being typed now, versus what
    // the user meant. A bare @ should open the full list.
    expect(typingStoreToken("milk @")).toBe("");
    expect(extractStoreTokens("milk @").stores).toEqual([]);
  });

  it("reports the partial store being typed", () => {
    expect(typingStoreToken("milk @tra")).toBe("tra");
  });

  it("reports only the last token, not the whole run", () => {
    // With two shops open the question is "tra", not "Target @tra".
    expect(typingStoreToken("milk @Target @tra")).toBe("tra");
  });

  it("reports nothing when no token is open", () => {
    expect(typingStoreToken("milk")).toBeNull();
  });

  it("names the shops already chosen, not the one being typed", () => {
    // What the suggestion list leaves out, so a second @ offers the rest.
    expect(storesTyped("milk @Target @tra")).toEqual(["Target"]);
    expect(storesTyped("milk @Target @")).toEqual(["Target"]);
    expect(storesTyped("milk @Target")).toEqual([]);
    expect(storesTyped("milk")).toEqual([]);
  });

  it("completes the open token", () => {
    expect(applyStoreToken("milk @tra", "Trader Joe's")).toBe(
      "milk @Trader Joe's"
    );
  });

  it("completes the second token without disturbing the first", () => {
    expect(applyStoreToken("milk @Target @tra", "Trader Joe's")).toBe(
      "milk @Target @Trader Joe's"
    );
  });

  it("appends a token when none is open", () => {
    expect(applyStoreToken("milk", "Target")).toBe("milk @Target");
  });

  it("handles a store chosen before anything was typed", () => {
    expect(applyStoreToken("@", "Target")).toBe("@Target");
  });
});

describe("storeSuggestions", () => {
  const known = ["Trader Joe's", "Target", "Whole Foods", "Trader's Hardware"];

  it("offers everything for an empty query", () => {
    expect(storeSuggestions(known, "")).toEqual(known);
  });

  it("puts prefix matches ahead of contained ones", () => {
    // "joe" should find Trader Joe's, but never ahead of a real prefix match.
    expect(storeSuggestions(known, "trader")).toEqual([
      "Trader Joe's",
      "Trader's Hardware",
    ]);
    expect(storeSuggestions(known, "joe")).toEqual(["Trader Joe's"]);
  });

  it("matches through punctuation and spacing", () => {
    // Uses the same normalised key as `sameStore`, so punctuation never decides
    // whether a suggestion appears.
    expect(storeSuggestions(known, "traderjoes")).toEqual(["Trader Joe's"]);
    expect(storeSuggestions(known, "whole foods")).toEqual(["Whole Foods"]);
  });

  it("returns nothing for a store nobody uses", () => {
    expect(storeSuggestions(known, "aldi")).toEqual([]);
  });

  it("leaves out shops already named on the line", () => {
    // Offering a shop the item already has would only duplicate it.
    expect(
      storeSuggestions(known, "", { exclude: ["trader joes", "Target"] })
    ).toEqual(["Whole Foods", "Trader's Hardware"]);
  });
});

// A fixed "now" so every relative label below is deterministic.
const NOW = new Date(2026, 7, 12, 9, 41); // Wed 12 Aug 2026, local

function fullItem(over: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    user_id: "00000000-0000-0000-0000-000000000002",
    title: "Milk",
    description: null,
    status: "inbox",
    priority: "p4",
    project_id: "00000000-0000-0000-0000-0000000000aa",
    scheduled_date: null,
    scheduled_time: null,
    deadline_date: null,
    deadline_time: null,
    duration_minutes: null,
    recurrence_rule: null,
    calendar_event_id: null,
    tags: [],
    parent_task_id: null,
    depth: 0,
    sort_order: 0,
    focus_override: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    completed_at: null,
    ...over,
  };
}

describe("itemSubline", () => {
  // The rule this function exists to keep: a bare item renders as a bare word.
  it("says nothing at all about an item with nothing set", () => {
    expect(itemSubline(fullItem(), { now: NOW })).toEqual([]);
  });

  it("names the store", () => {
    const withStore = fullItem({ tags: [storeTag("Trader Joe's")] });
    expect(itemSubline(withStore, { now: NOW })).toEqual(["Trader Joe's"]);
  });

  it("names two shops as one part, not two", () => {
    // The caller joins parts with a middot and the day is one of them, so
    // "Target · Costco · Fri" would read as three facts of the same kind.
    const both = fullItem({
      tags: [storeTag("Target"), storeTag("Costco")],
      scheduled_date: "2026-08-14",
    });
    expect(itemSubline(both, { now: NOW })).toEqual([
      "Target or Costco",
      "Fri, Aug 14",
    ]);
  });

  it("names the scheduled day — including today, which used to vanish", () => {
    expect(
      itemSubline(fullItem({ scheduled_date: "2026-08-12" }), { now: NOW })
    ).toEqual(["Today"]);
    expect(
      itemSubline(fullItem({ scheduled_date: "2026-08-14" }), { now: NOW })
    ).toEqual(["Fri, Aug 14"]);
  });

  it("puts the store before the day, the way a person says it", () => {
    const item = fullItem({
      tags: [storeTag("Target")],
      scheduled_date: "2026-08-13",
    });
    expect(itemSubline(item, { now: NOW })).toEqual(["Target", "Tomorrow"]);
  });

  it("prints an overdue item's age, not its date", () => {
    // "3 days ago" is the actionable form. It says this is something you keep
    // forgetting, which a bare date does not.
    expect(
      itemSubline(fullItem({ scheduled_date: "2026-08-09" }), { now: NOW })
    ).toEqual(["3 days ago"]);
  });

  it("carries a deadline as well as a scheduled day", () => {
    const item = fullItem({
      scheduled_date: "2026-08-13",
      deadline_date: "2026-08-15",
    });
    expect(itemSubline(item, { now: NOW })).toEqual([
      "Tomorrow",
      "Deadline Sat, Aug 15",
    ]);
  });

  it("drops the store when the caller has already named it", () => {
    // What a store-grouped list needs: the header above the row already said it.
    const item = fullItem({
      tags: [storeTag("Target")],
      scheduled_date: "2026-08-13",
    });
    expect(itemSubline(item, { now: NOW, hideStore: true })).toEqual([
      "Tomorrow",
    ]);
  });

  it("stops at the store once an item is in the cart", () => {
    // A bought item's date is no longer actionable once it is in the cart.
    const item = fullItem({
      status: "done",
      tags: [storeTag("Target")],
      scheduled_date: "2026-08-09",
    });
    expect(itemSubline(item, { now: NOW })).toEqual(["Target"]);
  });
});

describe("splitProjects", () => {
  const p = (name: string, kind?: Project["kind"]) => ({ name, kind });

  it("sends an absent kind to projects", () => {
    const { projects, lists } = splitProjects([
      p("Work"),
      p("Groceries", "list"),
      p("Home", "tasks"),
    ]);
    expect(projects.map((x) => x.name)).toEqual(["Work", "Home"]);
    expect(lists.map((x) => x.name)).toEqual(["Groceries"]);
  });

  it("preserves the incoming order within each side", () => {
    const { lists } = splitProjects([
      p("Amazon", "list"),
      p("Work"),
      p("Groceries", "list"),
    ]);
    expect(lists.map((x) => x.name)).toEqual(["Amazon", "Groceries"]);
  });
});
