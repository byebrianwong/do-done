import { describe, it, expect } from "vitest";
import type { Project, Task } from "./schemas.js";
import { isListProject, projectKind } from "./schemas.js";
import {
  STORE_TAG_PREFIX,
  gotItems,
  isGot,
  listSubline,
  normalizeStore,
  openItems,
  orderForShop,
  sameStore,
  splitProjects,
  storeHint,
  storeTag,
  storesOnList,
  summarizeList,
  withStoreHint,
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

describe("storeHint", () => {
  it("reads a prefixed tag and ignores ordinary ones", () => {
    expect(storeHint({ tags: ["urgent", `${STORE_TAG_PREFIX}Costco`] })).toBe("Costco");
    expect(storeHint({ tags: ["urgent", "costco"] })).toBeNull();
    expect(storeHint({ tags: [] })).toBeNull();
  });

  it("takes the first of several rather than joining them", () => {
    // A hint that says "here or here" has stopped being a hint; the second is
    // ignored rather than silently changing what the row means.
    expect(
      storeHint({ tags: [`${STORE_TAG_PREFIX}Costco`, `${STORE_TAG_PREFIX}Safeway`] })
    ).toBe("Costco");
  });

  it("ignores a bare prefix with no store after it", () => {
    expect(storeHint({ tags: [STORE_TAG_PREFIX] })).toBeNull();
    expect(storeHint({ tags: [`${STORE_TAG_PREFIX}   `] })).toBeNull();
  });
});

describe("withStoreHint", () => {
  it("keeps every other tag", () => {
    expect(withStoreHint(["urgent", "bulk"], "Costco")).toEqual([
      "urgent",
      "bulk",
      storeTag("Costco"),
    ]);
  });

  it("replaces rather than appends", () => {
    const once = withStoreHint([], "Costco");
    expect(withStoreHint(once, "Safeway")).toEqual([storeTag("Safeway")]);
  });

  it("clears on null or blank without touching the rest", () => {
    const tagged = withStoreHint(["urgent"], "Costco");
    expect(withStoreHint(tagged, null)).toEqual(["urgent"]);
    expect(withStoreHint(tagged, "   ")).toEqual(["urgent"]);
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
