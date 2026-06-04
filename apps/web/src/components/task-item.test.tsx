import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskItem } from "./task-item";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Isolate the row from the (heavy) edit modal subtree.
vi.mock("./task-edit-modal-v2", () => ({
  TaskEditModalV2: () => null,
}));

describe("TaskItem — touch affordances", () => {
  it("keeps the row action buttons visible on touch (mobile) and hover-revealed on desktop", () => {
    render(<TaskItem task={makeTask({ title: "Write report" })} projects={SAMPLE_PROJECTS} />);

    const editButton = screen.getByLabelText("Edit task");
    const actions = editButton.parentElement as HTMLElement;

    // Visible by default (touch has no hover)…
    expect(actions.className).toContain("opacity-100");
    // …but quietly hidden until hover on pointer (md+) devices.
    expect(actions.className).toContain("md:opacity-0");
    expect(actions.className).toContain("md:group-hover:opacity-100");
  });

  it("still exposes the complete toggle (core functionality) on mobile", () => {
    render(<TaskItem task={makeTask({ title: "Buy milk" })} />);
    expect(
      screen.getByRole("button", { name: /mark (in)?complete/i })
    ).toBeInTheDocument();
  });
});
