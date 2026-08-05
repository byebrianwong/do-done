import { describe, it, expect } from "vitest";
import {
  isCalendarVisible,
  pickDisplayCalendars,
  toHiddenIds,
} from "./calendar-selection.js";

const cal = (
  id: string,
  opts: { selected?: boolean; primary?: boolean } = {}
) => ({ id, selected: opts.selected ?? false, primary: opts.primary ?? false });

describe("isCalendarVisible", () => {
  it("defers to Google's flags when the user has never configured a selection", () => {
    expect(isCalendarVisible(cal("a", { selected: true }), null)).toBe(true);
    expect(isCalendarVisible(cal("b"), null)).toBe(false);
    // The primary calendar shows even when unticked in Google — it's the one
    // calendar a user always means.
    expect(isCalendarVisible(cal("c", { primary: true }), null)).toBe(true);
  });

  it("ignores Google's flags once a selection is stored", () => {
    // Unticked in Google but not hidden in DoDone: the whole point of the
    // picker is that the two lists can differ.
    expect(isCalendarVisible(cal("a"), [])).toBe(true);
    expect(isCalendarVisible(cal("b", { selected: true }), ["b"])).toBe(false);
  });

  it("shows a calendar absent from the stored exclusion set", () => {
    // The regression this feature exists for: a calendar created after the
    // last save must not need a visit to Settings to appear.
    expect(isCalendarVisible(cal("brand-new"), ["old-one"])).toBe(true);
  });

  it("skips entries with no id", () => {
    expect(isCalendarVisible({ id: null, selected: true }, null)).toBe(false);
    expect(isCalendarVisible({ selected: true }, [])).toBe(false);
  });
});

describe("pickDisplayCalendars", () => {
  it("keeps Google's list order and reports what the cap excluded", () => {
    const cals = ["a", "b", "c", "d"].map((id) => cal(id, { selected: true }));
    const { visible, overflow } = pickDisplayCalendars(cals, null, 2);
    expect(visible.map((c) => c.id)).toEqual(["a", "b"]);
    expect(overflow.map((c) => c.id)).toEqual(["c", "d"]);
  });

  it("spends the cap on chosen calendars, not on list position", () => {
    // The old bug: 22 calendars, cap applied to raw list order, so the one the
    // user cared about at position 19 never loaded. Hiding the noise ahead of
    // it is now enough to bring it back.
    const cals = [
      ...["holidays", "weather", "moon"].map((id) => cal(id, { selected: true })),
      cal("baby-lucas", { selected: true }),
    ];
    const { visible, overflow } = pickDisplayCalendars(
      cals,
      ["holidays", "weather"],
      2
    );
    expect(visible.map((c) => c.id)).toEqual(["moon", "baby-lucas"]);
    expect(overflow).toEqual([]);
  });

  it("returns nothing when everything is hidden", () => {
    const cals = [cal("a", { selected: true }), cal("b", { primary: true })];
    expect(pickDisplayCalendars(cals, ["a", "b"]).visible).toEqual([]);
  });

  it("defaults to the shared cap of 20", () => {
    const cals = Array.from({ length: 25 }, (_, i) =>
      cal(`c${i}`, { selected: true })
    );
    const { visible, overflow } = pickDisplayCalendars(cals, null);
    expect(visible).toHaveLength(20);
    expect(overflow).toHaveLength(5);
  });
});

describe("toHiddenIds", () => {
  it("stores the complement of the ticked boxes", () => {
    expect(toHiddenIds(["a", "b", "c"], new Set(["a", "c"]))).toEqual(["b"]);
  });

  it("is empty when everything is ticked, which means hide nothing", () => {
    expect(toHiddenIds(["a", "b"], new Set(["a", "b"]))).toEqual([]);
  });

  it("drops ids the picker no longer lists, so unsubscribed calendars don't accumulate", () => {
    expect(toHiddenIds(["a", "b"], new Set(["a"]))).toEqual(["b"]);
    expect(toHiddenIds(["a"], new Set(["a"]))).toEqual([]);
  });
});
