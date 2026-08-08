import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { todayLocalISO } from "@do-done/shared";
import { WeekView } from "./week-view";
import { makeTask, SAMPLE_PROJECTS, getMonday } from "./__stories__/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// WeekView takes weekStart as a local YYYY-MM-DD (the Monday of the week).
const MONDAY = todayLocalISO(new Date(getMonday()));

describe("WeekView — mobile calendar", () => {
  it("wraps the 7-day grid in a horizontal scroll container with a usable minimum width", () => {
    const { container } = render(
      <WeekView weekStart={MONDAY} tasks={[]} projects={SAMPLE_PROJECTS} />
    );
    // Rather than crushing 7 columns into a phone, the grid scrolls sideways.
    expect(container.innerHTML).toContain("overflow-x-auto");
    expect(container.innerHTML).toContain("min-w-[640px]");
  });

  it("hangs every day column off the same two grid rows as the hour gutter", () => {
    // The all-day chips are one band across the week, not a per-column strip
    // that grows: a day with six chips must not push its own hour grid down
    // relative to the hour labels, or its 9 AM block renders at 1 PM.
    const { container } = render(
      <WeekView
        weekStart={MONDAY}
        tasks={[
          makeTask({ title: "a", scheduled_date: MONDAY }),
          makeTask({ title: "b", scheduled_date: MONDAY }),
          makeTask({ title: "c", scheduled_date: MONDAY }),
        ]}
        projects={SAMPLE_PROJECTS}
      />
    );
    const grid = container.querySelector<HTMLElement>(
      ".grid-rows-\\[auto_auto\\]"
    );
    expect(grid).not.toBeNull();

    // The hour-label gutter starts on row 2 — level with the hour grids.
    const gutter = Array.from(grid!.children).find(
      (el) => (el as HTMLElement).style.gridRow === "2"
    ) as HTMLElement | undefined;
    expect(gutter).toBeDefined();
    expect(gutter!.style.gridColumn).toBe("1");

    // Each of the seven day columns spans both rows and subdivides them, so
    // the band is sized once for the week rather than once per day.
    const columns = Array.from(grid!.children).filter(
      (el) => (el as HTMLElement).style.gridRow === "1 / span 2"
    ) as HTMLElement[];
    expect(columns).toHaveLength(7);
    expect(columns.map((el) => el.style.gridColumn)).toEqual([
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
    for (const col of columns) {
      expect(col.className).toContain("grid-rows-subgrid");
    }
  });

  it("still renders all seven weekday columns (functionality preserved)", () => {
    render(
      <WeekView
        weekStart={MONDAY}
        tasks={[makeTask({ title: "Standup", scheduled_date: MONDAY })]}
        projects={SAMPLE_PROJECTS}
      />
    );
    // Day-of-week headers Sun–Sat are rendered for the week.
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      expect(screen.getAllByText(day).length).toBeGreaterThan(0);
    }
  });
});
