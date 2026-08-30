/**
 * A list row does two different things, and which one a click means depends on
 * where it lands.
 *
 * The whole row used to be one button that ticked the item off, so a click
 * meant for "what did I write here" bought the milk instead — on the surface
 * that gets clicked fastest, and with the mistake only visible as a row moving
 * into the cart. The circle ticks; the words open the item's editor.
 *
 * Asserted through the URL rather than by looking for a modal: the editor is
 * mounted app-wide by `OpenTaskProvider`, and `?task=<id>` is the observable
 * thing this component is responsible for producing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Project } from "@do-done/shared";
import { OpenTaskProvider } from "@/lib/open-task";
import { makeTask } from "@/components/__stories__/mocks";
import { ListView } from "./list-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/lists/list-1",
  useRouter: () => ({ refresh: () => {} }),
}));

const complete = vi.fn();
const reopen = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: async () => ({
    complete,
    reopen,
    create,
    update,
    getById: async () => ({ data: null, error: null }),
  }),
}));

vi.mock("@/lib/supabase/pantry-client", () => ({
  getClientPantryApi: async () => ({
    load: async () => ({ data: [], error: null }),
  }),
}));

vi.mock("@/lib/supabase/aisle-terms-client", () => ({
  getClientAisleTermsApi: async () => ({
    load: async () => ({ data: new Map(), error: null }),
  }),
}));

const LIST = {
  id: "list-1",
  name: "Groceries",
  color: "#6366f1",
  kind: "list",
} as unknown as Project;

const ITEM = makeTask({
  id: "item-1",
  title: "Bananas",
  project_id: "list-1",
});

function mount() {
  return render(
    <OpenTaskProvider>
      <ListView list={LIST} initialItems={[ITEM]} />
    </OpenTaskProvider>
  );
}

/** The `?task=` id currently in the address bar. */
function paramId(): string | null {
  return new URLSearchParams(window.location.search).get("task");
}

beforeEach(() => {
  complete.mockReset();
  complete.mockResolvedValue({ data: null, error: null });
  reopen.mockReset();
  reopen.mockResolvedValue({ data: null, error: null });
  create.mockReset();
  create.mockResolvedValue({
    data: makeTask({ id: "item-2", title: "Olive oil", project_id: "list-1" }),
    error: null,
  });
  update.mockReset();
  update.mockResolvedValue({ data: null, error: null });
  window.history.replaceState(null, "", "/lists/list-1");
});

describe("a shopping-list row", () => {
  it("opens the item when its words are clicked", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Bananas" }));

    expect(paramId()).toBe("item-1");
    // The rule under test: reading an item must not buy it.
    expect(complete).not.toHaveBeenCalled();
  });

  it("ticks the item when the circle is clicked", async () => {
    mount();
    await userEvent.click(
      screen.getByRole("button", { name: /Mark Bananas as bought/ })
    );

    expect(complete).toHaveBeenCalledWith("item-1");
    // And ticking must not open anything over the list being walked.
    expect(paramId()).toBeNull();
  });
});

/**
 * The composer's leading plus used to be a bare `+` glyph that did nothing,
 * while every other plus in the app is a button. It is one control now, and
 * what it does depends on which end of the field it is parked at.
 *
 * Both halves are asserted because either can rot on its own: the idle half is
 * the only reason a plus is defensible here at all, and the live half is the
 * only commit control this composer has.
 */
describe("the composer's action glyph", () => {
  it("focuses the field when it is a plus", async () => {
    mount();
    const field = screen.getByPlaceholderText("Add an item to buy");
    // The field autofocuses, so the glyph starts at the trailing edge. Step
    // away first to reach the state a returning user sees.
    field.blur();

    await userEvent.click(screen.getByRole("button", { name: "Add an item" }));

    expect(field).toHaveFocus();
    expect(create).not.toHaveBeenCalled();
  });

  it("commits the item when it is a return key", async () => {
    mount();
    await userEvent.type(
      screen.getByPlaceholderText("Add an item to buy"),
      "Olive oil"
    );

    await userEvent.click(screen.getByRole("button", { name: "Add this item" }));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Olive oil", project_id: "list-1" })
    );
  });
});

/**
 * An item can be sold in more than one place, so the row's control adds shops
 * rather than replacing one.
 *
 * The failure this guards against is silent: a control that overwrites looks
 * identical while you type the second shop, and the loss only shows up as an
 * item filed at one place when you named two.
 */
describe("the shops on an item", () => {
  /**
   * The row's "add a shop" field, invisible until the row is hovered. A
   * combobox rather than a textbox: it is backed by a <datalist>.
   */
  function storeField(title: string) {
    return screen.getByRole("combobox", { name: `Add a shop for ${title}` });
  }

  /** The `tags` array the last `update` call would have written. */
  function writtenTags(): string[] {
    return update.mock.calls.at(-1)?.[1].tags ?? [];
  }

  it("adds a second shop beside the first", async () => {
    render(
      <OpenTaskProvider>
        <ListView
          list={LIST}
          initialItems={[{ ...ITEM, tags: ["at:Target"] }]}
        />
      </OpenTaskProvider>
    );

    await userEvent.type(storeField("Bananas"), "Trader Joe's{Enter}");

    expect(writtenTags()).toEqual(["at:Target", "at:Trader Joe's"]);
  });

  it("clears the field after adding, so the next shop can follow", async () => {
    mount();
    await userEvent.type(storeField("Bananas"), "Target{Enter}");
    expect(storeField("Bananas")).toHaveValue("");
  });

  it("takes one shop off and leaves the other", async () => {
    render(
      <OpenTaskProvider>
        <ListView
          list={LIST}
          initialItems={[{ ...ITEM, tags: ["at:Target", "at:Costco"] }]}
        />
      </OpenTaskProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove Target" }));

    expect(writtenTags()).toEqual(["at:Costco"]);
  });

  it("names both shops under the item, each one removable", async () => {
    render(
      <OpenTaskProvider>
        <ListView
          list={LIST}
          initialItems={[{ ...ITEM, tags: ["at:Target", "at:Costco"] }]}
        />
      </OpenTaskProvider>
    );

    // The shops are stated once, in the line under the title, and that line is
    // also where they come off. The row's hover overlay holds the field that
    // adds one; it is invisible at rest, so shops shown only there would be
    // shown nowhere.
    expect(screen.getByRole("button", { name: "Remove Target" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Costco" })).toBeInTheDocument();
  });
});
