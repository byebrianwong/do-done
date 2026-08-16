import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lists must be reachable by someone who has never made one.
 *
 * The sidebar's Lists section renders only when `lists.length > 0`, on purpose
 * — a permanent heading for an unused feature is exactly the clutter shopping
 * lists exist to avoid. But when the feature shipped, that conditional link was
 * the *only* route to `/lists`, and the page behind it is the only place a list
 * can be created. So the sidebar needed a list to show the link, and the link
 * was needed to make the first list: the whole feature was unreachable on every
 * real account, while working perfectly in the demo, whose seed has two lists.
 *
 * These read source text rather than rendering, which is unusual here and is
 * the point: the bug was an *absence*, and a rendering test only ever asserts
 * about the component you remembered to render. What has to stay true is that
 * an unconditional door exists somewhere, so the test looks for the doors.
 */

// Anchored on the vitest root (apps/web) rather than __dirname, which does
// not resolve to this file's directory under the jsdom/ESM setup here.
const SRC = join(process.cwd(), "src");

function source(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8");
}

describe("/lists is reachable without already having a list", () => {
  it("has a door in the command palette", () => {
    // The palette is where you look for a page you cannot see, so it is
    // exactly the wrong place to gate on having been there before.
    const palette = source("components", "command-palette.tsx");
    expect(palette).toContain('href: "/lists"');
  });

  it("has a door in Settings", () => {
    // Where someone coming from the phone looks, since mobile keeps its list
    // screen under Settings too.
    const settings = source("app", "(app)", "settings", "page.tsx");
    expect(settings).toContain('href="/lists"');
  });

  it("keeps the sidebar section conditional", () => {
    // The other half of the rule: fixing reachability must not be done by
    // showing an empty heading to everyone forever.
    const sidebar = source("components", "sidebar-nav.tsx");
    expect(sidebar).toContain("lists.length > 0");
  });

  it("survives the sidebar link being removed entirely", () => {
    // The real invariant, stated the only way that catches a regression: at
    // least one door outside the conditional block. Both are checked above;
    // this asserts they are not the same file as the conditional one.
    const doors = [
      source("components", "command-palette.tsx").includes('href: "/lists"'),
      source("app", "(app)", "settings", "page.tsx").includes('href="/lists"'),
    ].filter(Boolean);
    expect(doors.length).toBeGreaterThanOrEqual(1);
  });
});
