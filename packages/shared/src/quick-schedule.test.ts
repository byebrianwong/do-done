import { describe, expect, it } from "vitest";
import { PHOSPHOR_PATHS } from "./phosphor-data.generated.js";
import { QUICK_SCHEDULE, QUICK_SCHEDULE_ICON_WEIGHT } from "./utils.js";

/**
 * The menu icons are Phosphor names looked up at render time, so a name that
 * is not in `PHOSPHOR_PATHS` draws nothing at all — no error, no fallback, just
 * a menu row that lost its icon. Regenerating the catalogue without `EXTRA`
 * (see `tools/phosphor/catalogue.mjs`) is exactly how that would happen, and
 * nothing else in the build would notice.
 */
describe("quick-schedule icons", () => {
  it("names an icon the generated data actually has", () => {
    for (const option of QUICK_SCHEDULE) {
      expect(PHOSPHOR_PATHS[option.icon], option.key).toBeDefined();
    }
  });

  it("has paths in the weight the menus draw", () => {
    for (const option of QUICK_SCHEDULE) {
      const paths = PHOSPHOR_PATHS[option.icon][QUICK_SCHEDULE_ICON_WEIGHT];
      expect(paths.length, option.key).toBeGreaterThan(0);
    }
  });

  // Five identical calendars is the state this replaced; a duplicate would
  // silently restore it for two of the rows.
  it("gives every option its own glyph", () => {
    const icons = QUICK_SCHEDULE.map((o) => o.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  /**
   * `fill` draws `caret-right` as a solid triangle rather than a chevron, so a
   * well-meaning switch to the project-icon default would quietly turn "This
   * week" and "Next week" into play buttons.
   */
  it("is not the fill weight the carets degrade in", () => {
    expect(QUICK_SCHEDULE_ICON_WEIGHT).not.toBe("fill");
  });
});
