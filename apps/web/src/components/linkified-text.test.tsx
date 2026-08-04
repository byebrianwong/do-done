import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LinkifiedText } from "./linkified-text";

describe("LinkifiedText", () => {
  it("renders a URL in the title as an anchor to that URL", () => {
    render(<LinkifiedText text="Buy dog food https://www.example.com/" />);
    const link = screen.getByRole("link", {
      name: "https://www.example.com/",
    });
    expect(link.getAttribute("href")).toBe("https://www.example.com/");
    // Opens safely in a new tab.
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps the non-URL text alongside the link", () => {
    const { container } = render(
      <LinkifiedText text="Buy dog food https://example.com/" />
    );
    expect(container.textContent).toBe("Buy dog food https://example.com/");
  });

  it("gives a bare www. link an https:// href", () => {
    render(<LinkifiedText text="see www.example.com" />);
    const link = screen.getByRole("link", { name: "www.example.com" });
    expect(link.getAttribute("href")).toBe("https://www.example.com");
  });

  it("renders plain text with no links when there is no URL", () => {
    const { container } = render(<LinkifiedText text="Buy dog food" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("Buy dog food");
  });

  it("does not bubble the link click up to a clickable ancestor (row → editor)", () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <LinkifiedText text="open https://example.com/" />
      </div>
    );
    const link = screen.getByRole("link");
    // Anchor navigation would leave jsdom; prevent it and assert propagation
    // stopped so the ancestor's handler never runs.
    link.addEventListener("click", (e) => e.preventDefault());
    link.click();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("lets mousedown reach a draggable ancestor so the row still drags", () => {
    // dnd-kit activates on the row's onMouseDown. Swallowing it here would
    // make a task whose title is mostly a URL impossible to drag.
    const onRowMouseDown = vi.fn();
    render(
      <div onMouseDown={onRowMouseDown}>
        <LinkifiedText text="open https://example.com/" />
      </div>
    );
    fireEvent.mouseDown(screen.getByRole("link"));
    expect(onRowMouseDown).toHaveBeenCalled();
  });

  it("opts out of the browser's native link drag", () => {
    // Without this the browser drags the URL itself, beating dnd-kit to the
    // gesture before its 4px activation threshold.
    render(<LinkifiedText text="open https://example.com/" />);
    expect(screen.getByRole("link")).toHaveAttribute("draggable", "false");
  });
});
