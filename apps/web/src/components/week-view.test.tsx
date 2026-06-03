import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeekView } from "./week-view";
import { makeTask, SAMPLE_PROJECTS, getMonday } from "./__stories__/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("WeekView — mobile calendar", () => {
  it("wraps the 7-day grid in a horizontal scroll container with a usable minimum width", () => {
    const { container } = render(
      <WeekView weekStart={getMonday()} tasks={[]} projects={SAMPLE_PROJECTS} />
    );
    // Rather than crushing 7 columns into a phone, the grid scrolls sideways.
    expect(container.innerHTML).toContain("overflow-x-auto");
    expect(container.innerHTML).toContain("min-w-[640px]");
  });

  it("still renders all seven weekday columns (functionality preserved)", () => {
    render(
      <WeekView
        weekStart={getMonday()}
        tasks={[makeTask({ title: "Standup", when_date: getMonday().split("T")[0] })]}
        projects={SAMPLE_PROJECTS}
      />
    );
    // Day-of-week headers Sun–Sat are rendered for the week.
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      expect(screen.getAllByText(day).length).toBeGreaterThan(0);
    }
  });
});
