import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useBackdropDismiss } from "./backdrop-dismiss";

function Overlay({ onDismiss }: { onDismiss: () => void }) {
  const backdrop = useBackdropDismiss<HTMLDivElement>(onDismiss);
  return (
    <div data-testid="overlay" {...backdrop}>
      <div data-testid="dialog" onClick={(e) => e.stopPropagation()}>
        <textarea data-testid="title" defaultValue="a very long task title" />
      </div>
    </div>
  );
}

describe("useBackdropDismiss", () => {
  it("dismisses when the press and the release both land on the backdrop", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.mouseDown(overlay);
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays open when a selection started in the title is released on the backdrop", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    const overlay = screen.getByTestId("overlay");

    // The browser dispatches the click on the *common ancestor* of the press
    // and the release — the overlay itself — so this is indistinguishable from
    // a real backdrop click by target alone. This is the reported bug: dragging
    // to select a long title and letting go outside the dialog closed it.
    fireEvent.mouseDown(screen.getByTestId("title"));
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("stays open when a press on the backdrop is released inside the dialog", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.mouseDown(overlay);
    fireEvent.mouseUp(screen.getByTestId("title"));
    fireEvent.click(overlay);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not carry an aborted gesture over to the next click", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.mouseDown(screen.getByTestId("title"));
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseDown(overlay);
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores a click inside the dialog", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);

    fireEvent.mouseDown(screen.getByTestId("dialog"));
    fireEvent.mouseUp(screen.getByTestId("dialog"));
    fireEvent.click(screen.getByTestId("dialog"));

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
