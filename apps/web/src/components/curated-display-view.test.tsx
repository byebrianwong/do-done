import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { defaultDisplayFor, type Task } from "@do-done/shared";

// The Display menu pulls in the whole filter/group/sort UI (and a projects
// popover); this suite is about what reaches `renderCurated`, not the chrome.
vi.mock("./display-menu", () => ({ DisplayMenu: () => null }));

// The real hook hydrates from localStorage and then reconciles against
// user_preferences over the network. Pin it to the view's default — which is
// manual sort, the config a curated layout is only ever shown under.
vi.mock("@/lib/use-display-config", () => ({
  useDisplayConfig: (viewKey: string) => ({
    config: defaultDisplayFor(viewKey),
    setConfig: vi.fn(),
    reset: vi.fn(),
    isDefault: true,
  }),
}));

import { CuratedDisplayView } from "./curated-display-view";
import { makeTask } from "./__stories__/mocks";

/** Rows as the query hands them over: nothing about their array order says
 *  anything about the order the user dragged them into. */
function scrambled(): Task[] {
  return [
    makeTask({ id: "c", title: "C", sort_order: 3000 }),
    makeTask({ id: "a", title: "A", sort_order: 1000 }),
    makeTask({ id: "d", title: "D", sort_order: 4000 }),
    makeTask({ id: "b", title: "B", sort_order: 2000 }),
  ];
}

function renderCuratedWith(tasks: Task[]): string[] {
  let seen: string[] = [];
  render(
    <CuratedDisplayView
      viewKey="upcoming"
      title="Upcoming"
      allTasks={tasks}
      curatedWhen={() => true}
      renderCurated={(filtered) => {
        seen = filtered.map((t) => t.id);
        return null;
      }}
    />
  );
  return seen;
}

describe("CuratedDisplayView", () => {
  it("hands the curated layout its rows in sort_order — the order a drag wrote", () => {
    // Upcoming's day columns and Today's focus sections render this array as
    // given. Passing it through unsorted meant a drop wrote a new sort_order
    // and the refresh read the query's own ordering back, so the row slid out
    // of the slot it had just been dropped into.
    expect(renderCuratedWith(scrambled())).toEqual(["a", "b", "c", "d"]);
  });

  it("still applies the config's filters", () => {
    const tasks = [
      ...scrambled(),
      makeTask({ id: "done", title: "Done", sort_order: 0, status: "done" }),
    ];
    expect(renderCuratedWith(tasks)).not.toContain("done");
  });
});
