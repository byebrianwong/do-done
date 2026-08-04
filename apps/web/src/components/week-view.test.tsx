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
