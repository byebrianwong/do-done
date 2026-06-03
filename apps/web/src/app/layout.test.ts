import { describe, it, expect } from "vitest";
import { viewport } from "./layout";

// The single most impactful mobile fix: without `width=device-width` the
// browser uses a ~980px layout viewport and renders the desktop UI zoomed
// out. This guards that the viewport export stays mobile-correct.
describe("root layout viewport", () => {
  it("opts into the device width so phones don't get a zoomed-out desktop layout", () => {
    expect(viewport.width).toBe("device-width");
  });

  it("starts at scale 1 (not zoomed out)", () => {
    expect(viewport.initialScale).toBe(1);
  });
});
