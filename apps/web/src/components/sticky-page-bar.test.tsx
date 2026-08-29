import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { StickyPageBar } from "./sticky-page-bar";

/**
 * The bar's own logic, with the browser's IntersectionObserver stood in for.
 *
 * What is being tested is the part that can be wrong: that the observer is
 * given the right root margin, that the class flips both ways, and that the
 * title starts hidden. Whether a real browser then pins a `position: sticky`
 * element is the browser's job, not ours — and jsdom has no layout to check it
 * with either.
 *
 * The margin matters more than it looks. It is what decides *when* the bar
 * takes over, and it has to be resolved from the CSS tokens in pixels, because
 * `rootMargin` accepts neither `calc()` nor a custom property — passing one
 * throws and the handoff never happens at all.
 */
type ObserverCall = { margin: string; fire: (isIntersecting: boolean) => void };

let calls: ObserverCall[] = [];

class FakeIntersectionObserver {
  constructor(
    private cb: IntersectionObserverCallback,
    private options?: IntersectionObserverInit
  ) {}
  observe() {
    calls.push({
      margin: String(this.options?.rootMargin ?? ""),
      fire: (isIntersecting: boolean) =>
        this.cb(
          [{ isIntersecting } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        ),
    });
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  // The tokens the component resolves. jsdom applies no stylesheet, so they are
  // set on the element getComputedStyle will read them from.
  document.documentElement.style.setProperty("--dd-appbar-h", "0rem");
  document.documentElement.style.setProperty("--dd-pagebar-h", "3rem");
  document.documentElement.style.fontSize = "16px";
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--dd-appbar-h");
  document.documentElement.style.removeProperty("--dd-pagebar-h");
});

function barTitle() {
  // The h1 and the bar's copy carry the same words; the bar's is the <span>.
  return screen
    .getAllByText("All tasks")
    .find((el) => el.tagName === "SPAN") as HTMLElement;
}

describe("StickyPageBar", () => {
  it("resolves the pinned height into a pixel root margin", () => {
    render(
      <StickyPageBar title="All tasks">
        <div>rows</div>
      </StickyPageBar>
    );
    // 0rem app bar + 3rem page bar at 16px = 48px.
    expect(calls[0]?.margin).toBe("-48px 0px 0px 0px");
  });

  it("includes the app bar's height where there is one (below md)", () => {
    document.documentElement.style.setProperty("--dd-appbar-h", "3.5rem");
    render(
      <StickyPageBar title="All tasks">
        <div>rows</div>
      </StickyPageBar>
    );
    // 3.5rem + 3rem = 104px.
    expect(calls[0]?.margin).toBe("-104px 0px 0px 0px");
  });

  it("hands the title to the bar only once the heading has gone", () => {
    render(
      <StickyPageBar title="All tasks">
        <div>rows</div>
      </StickyPageBar>
    );

    // At rest the big <h1> is doing the work and the bar's copy is invisible.
    expect(barTitle().className).toContain("opacity-0");
    expect(barTitle()).toHaveAttribute("aria-hidden", "true");

    act(() => calls[0].fire(false)); // sentinel gone: the bar takes over
    expect(barTitle().className).toContain("opacity-100");
    expect(barTitle()).toHaveAttribute("aria-hidden", "false");

    act(() => calls[0].fire(true)); // scrolled back to the top
    expect(barTitle().className).toContain("opacity-0");
  });

  it("raises the sticky offset for the group headers it wraps", () => {
    const { container } = render(
      <StickyPageBar title="All tasks">
        <div>rows</div>
      </StickyPageBar>
    );
    // The offsets are classes from globals.css, so the two numbers that have
    // to agree — the bar's height and the headers' `top` — are written once.
    expect(container.querySelector(".dd-stick-scope")).toBeTruthy();
    expect(container.querySelector(".dd-pagebar")).toBeTruthy();
  });

  it("still renders its children when there is no observer at all", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <StickyPageBar title="All tasks">
        <div>rows</div>
      </StickyPageBar>
    );
    expect(screen.getByText("rows")).toBeInTheDocument();
  });
});
