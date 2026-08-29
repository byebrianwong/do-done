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
vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: async () => ({
    complete,
    reopen,
    getById: async () => ({ data: null, error: null }),
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
