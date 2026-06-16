import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectPickerPopover } from "./project-picker";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

// Assertions deliberately avoid jest-dom matchers (getByText/getByPlaceholderText
// throw on miss, so they assert presence on their own) — this suite proves the
// picker's render + interaction wiring without depending on matcher setup.

function setup(overrides: Partial<Parameters<typeof ProjectPickerPopover>[0]> = {}) {
  const onSelect = vi.fn();
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <ProjectPickerPopover
      projects={SAMPLE_PROJECTS}
      selectedId="proj-1"
      userId="user-1"
      onSelect={onSelect}
      onCreated={onCreated}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onSelect, onCreated, onClose };
}

describe("ProjectPickerPopover", () => {
  it("lists the clear option, every project, and the create affordance", () => {
    setup();
    screen.getByText("No project");
    screen.getByText("Engineering");
    screen.getByText("Personal");
    screen.getByText("New project");
  });

  it("selects an existing project by name and closes", () => {
    const { onSelect, onClose } = setup();
    fireEvent.click(screen.getByText("Personal"));
    expect(onSelect).toHaveBeenCalledWith("proj-2");
    expect(onClose).toHaveBeenCalled();
  });

  it("clears the project via 'No project'", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByText("No project"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("reveals the inline create form (name input) on demand", () => {
    setup();
    // Not present until requested.
    expect(screen.queryByPlaceholderText("Project name…")).toBeNull();
    fireEvent.click(screen.getByText("New project"));
    screen.getByPlaceholderText("Project name…");
  });
});
