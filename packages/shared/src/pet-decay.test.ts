import { describe, it, expect } from "vitest";
import {
  computeCurrentStats,
  deriveMood,
  applyTaskDeltas,
  hungerFromEstimate,
  priorityHappinessBonus,
  applyCreateEnergy,
  applyEditEnergy,
  isFieldFilled,
  type PetStatsSnapshot,
  type CurrentStats,
  type TaskDeltaProps,
} from "./pet-decay.js";
import {
  DEFAULT_DECAY_PREFERENCES,
  ROTATING_POSITIVE_MOODS,
  type PetDecayPreferences,
} from "./schemas.js";

const PREFS: PetDecayPreferences = { ...DEFAULT_DECAY_PREFERENCES };

function snapshot(
  hunger: number,
  happiness: number,
  energy: number,
  lastSeen: string
): PetStatsSnapshot {
  return {
    hunger_at_last_seen: hunger,
    happiness_at_last_seen: happiness,
    energy_at_last_seen: energy,
    last_seen_at: lastSeen,
  };
}

describe("computeCurrentStats", () => {
  it("zero elapsed: stats unchanged", () => {
    const base = snapshot(80, 80, 80, "2026-05-01T16:00:00Z");
    const stats = computeCurrentStats(
      base,
      PREFS,
      new Date("2026-05-01T16:00:00Z")
    );
    expect(stats).toEqual({ hunger: 80, happiness: 80, energy: 80 });
  });

  it("future last_seen_at clamps to zero elapsed (no boost)", () => {
    const future = snapshot(100, 100, 100, "2026-06-01T00:00:00Z");
    const stats = computeCurrentStats(
      future,
      PREFS,
      new Date("2026-05-01T00:00:00Z")
    );
    expect(stats).toEqual({ hunger: 100, happiness: 100, energy: 100 });
  });

  it("hunger decays by hunger_daily_decay per local midnight crossed", () => {
    // Snapshot at noon Friday May 1 ET, read at noon Sunday May 3 ET → 2 midnights.
    const base = snapshot(80, 80, 80, "2026-05-01T16:00:00Z");
    const stats = computeCurrentStats(
      base,
      PREFS,
      new Date("2026-05-03T16:00:00Z")
    );
    expect(stats.hunger).toBe(80 - 2 * PREFS.hunger_daily_decay);
  });

  it("hunger decay scales with hunger_daily_decay preference", () => {
    const base = snapshot(80, 80, 80, "2026-05-01T16:00:00Z");
    const stats = computeCurrentStats(
      base,
      { ...PREFS, hunger_daily_decay: 10 },
      new Date("2026-05-04T16:00:00Z") // 3 midnights
    );
    expect(stats.hunger).toBe(80 - 3 * 10);
  });

  it("happiness decays by happiness_weekly_decay per week-end-day crossing", () => {
    // week_end_day=0 (Sunday). Snapshot Fri May 1 12pm ET, read Mon May 4 12pm ET
    // crosses one Sunday-night midnight → 1 tick of -10.
    const base = snapshot(80, 80, 80, "2026-05-01T16:00:00Z");
    const stats = computeCurrentStats(
      base,
      PREFS,
      new Date("2026-05-04T16:00:00Z")
    );
    expect(stats.happiness).toBe(80 - PREFS.happiness_weekly_decay);
  });

  it("happiness decay scales with happiness_weekly_decay preference", () => {
    const base = snapshot(80, 80, 80, "2026-05-01T16:00:00Z");
    const stats = computeCurrentStats(
      base,
      { ...PREFS, happiness_weekly_decay: 25 },
      new Date("2026-05-18T16:00:00Z") // crosses 2 Sundays (May 3, May 10, May 17 → 3 ticks)
    );
    expect(stats.happiness).toBe(Math.max(0, 80 - 3 * 25));
  });

  it("week_end_day=6 (Saturday) ticks on Saturday-night midnights", () => {
    // Snapshot Sunday May 3 12pm ET → read Monday May 11 12pm ET. With
    // week_end_day=6 (Sat), tick fires at midnight rolling Sat→Sun.
    // Saturdays in range: May 9 → 1 tick.
    const base = snapshot(80, 80, 80, "2026-05-03T16:00:00Z");
    const stats = computeCurrentStats(
      base,
      { ...PREFS, week_end_day: 6 },
      new Date("2026-05-11T16:00:00Z")
    );
    expect(stats.happiness).toBe(80 - PREFS.happiness_weekly_decay);
  });

  it("energy decays 1pt/hr only during 8a-8p local", () => {
    // Snapshot at 12pm ET, read 12 hours later (midnight ET). Waking
    // hours covered: 12pm-8pm = 8 hours. Energy drops by ~8.
    const base = snapshot(80, 80, 80, "2026-05-01T16:00:00Z"); // 12pm ET
    const stats = computeCurrentStats(
      base,
      PREFS,
      new Date("2026-05-02T04:00:00Z") // midnight ET
    );
    expect(stats.energy).toBe(80 - 8);
  });

  it("energy doesn't decay during overnight 8p-8a", () => {
    // 9pm ET → 5am ET next day = entirely outside 8a-8p window.
    const base = snapshot(80, 80, 80, "2026-05-02T01:00:00Z"); // 9pm ET May 1
    const stats = computeCurrentStats(
      base,
      PREFS,
      new Date("2026-05-02T09:00:00Z") // 5am ET May 2
    );
    expect(stats.energy).toBe(80);
  });

  it("energy decays at most 12 pts/day (full 8a-8p window)", () => {
    const base = snapshot(80, 80, 80, "2026-05-01T12:00:00Z"); // 8am ET
    const stats = computeCurrentStats(
      base,
      PREFS,
      new Date("2026-05-02T00:00:00Z") // 8pm ET same day
    );
    expect(stats.energy).toBe(80 - 12);
  });

  it("clamps stats to 0 on prolonged neglect", () => {
    const base = snapshot(10, 10, 10, "2026-05-01T12:00:00Z");
    const stats = computeCurrentStats(
      base,
      PREFS,
      new Date("2026-09-01T12:00:00Z") // ~4 months later
    );
    expect(stats.hunger).toBe(0);
    expect(stats.happiness).toBe(0);
    expect(stats.energy).toBe(0);
  });

  it("returns integers", () => {
    const stats = computeCurrentStats(
      snapshot(95, 95, 95, "2026-05-01T16:00:00Z"),
      PREFS,
      new Date("2026-05-01T17:30:00Z")
    );
    expect(Number.isInteger(stats.hunger)).toBe(true);
    expect(Number.isInteger(stats.happiness)).toBe(true);
    expect(Number.isInteger(stats.energy)).toBe(true);
  });

  it("accepts Date object for last_seen_at", () => {
    const snap: PetStatsSnapshot = {
      hunger_at_last_seen: 80,
      happiness_at_last_seen: 80,
      energy_at_last_seen: 80,
      last_seen_at: new Date("2026-05-01T16:00:00Z"),
    };
    const stats = computeCurrentStats(
      snap,
      PREFS,
      new Date("2026-05-02T16:00:00Z")
    );
    expect(stats.hunger).toBe(80 - PREFS.hunger_daily_decay);
  });
});

describe("deriveMood", () => {
  const noon = new Date("2026-05-01T16:00:00Z"); // noon ET
  const midnight = new Date("2026-05-02T04:00:00Z"); // midnight ET

  function stats(h: number, ha: number, e: number): CurrentStats {
    return { hunger: h, happiness: ha, energy: e };
  }

  it("hungry when hunger < 30", () => {
    expect(deriveMood(stats(20, 80, 80), null, PREFS, noon)).toBe("hungry");
  });

  it("tired when energy < 30 (and hunger ok)", () => {
    expect(deriveMood(stats(80, 80, 20), null, PREFS, noon)).toBe("tired");
  });

  it("never returns 'sad' even when happiness is 0", () => {
    const m = deriveMood(stats(80, 0, 80), null, PREFS, noon);
    expect(m).not.toBe("sad");
    // Falls through to the rotating positive expression set.
    expect(ROTATING_POSITIVE_MOODS).toContain(m);
  });

  it("low happiness alone does not change mood (Pip stays positive)", () => {
    const happy = deriveMood(stats(80, 80, 80), null, PREFS, noon);
    const lowHappy = deriveMood(stats(80, 10, 80), null, PREFS, noon);
    expect(happy).toBe(lowHappy);
  });

  it("returns a positive mood when all stats healthy", () => {
    const m = deriveMood(stats(80, 80, 80), null, PREFS, noon);
    expect(ROTATING_POSITIVE_MOODS).toContain(m);
  });

  it("rotating mood is deterministic for a given time bucket", () => {
    const a = deriveMood(stats(80, 80, 80), null, PREFS, noon);
    const b = deriveMood(stats(80, 80, 80), null, PREFS, noon);
    expect(a).toBe(b);
  });

  it("rotating mood changes across time buckets (varies over hours)", () => {
    const seen = new Set<string>();
    // Sample 48 buckets (24 hours of 30-min slices) — expect at least 2 distinct moods.
    for (let i = 0; i < 48; i++) {
      const t = new Date(noon.getTime() + i * 30 * 60_000);
      seen.add(deriveMood(stats(80, 80, 80), null, PREFS, t));
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it("sleeping when idle > 8h AND nighttime", () => {
    const idle = new Date("2026-05-01T12:00:00Z"); // 16h before midnight ET
    expect(deriveMood(stats(80, 80, 80), idle, PREFS, midnight)).toBe(
      "sleeping"
    );
  });

  it("not sleeping if daytime even when idle > 8h", () => {
    const idle = new Date("2026-05-01T00:00:00Z");
    const m = deriveMood(stats(80, 80, 80), idle, PREFS, noon);
    expect(m).not.toBe("sleeping");
    expect(ROTATING_POSITIVE_MOODS).toContain(m);
  });

  it("not sleeping if idle <= 8h even at night", () => {
    const idle = new Date("2026-05-02T00:00:00Z"); // 4h before midnight ET
    const m = deriveMood(stats(80, 80, 80), idle, PREFS, midnight);
    expect(m).not.toBe("sleeping");
  });

  it("hungry takes priority over tired", () => {
    expect(deriveMood(stats(10, 10, 10), null, PREFS, noon)).toBe("hungry");
  });

  it("sleeping takes priority over hungry/tired when at night + idle", () => {
    const idle = new Date("2026-05-01T12:00:00Z");
    expect(deriveMood(stats(10, 10, 10), idle, PREFS, midnight)).toBe(
      "sleeping"
    );
  });
});

describe("applyTaskDeltas (completion feeding)", () => {
  const stats: CurrentStats = { hunger: 50, happiness: 50, energy: 50 };
  // noon ET, May 1 2026 — used as `now` for date comparisons.
  const now = new Date("2026-05-01T16:00:00Z");

  function task(overrides: Partial<TaskDeltaProps> = {}): TaskDeltaProps {
    return {
      priority: "p3",
      deadline_date: null,
      scheduled_date: null,
      duration_minutes: null,
      ...overrides,
    };
  }

  it("hunger from estimate, default 1 when no estimate", () => {
    const r = applyTaskDeltas(stats, task(), "user", PREFS, now);
    expect(r.deltas.hunger).toBe(1);
  });

  it("hunger from estimate: 60min → +2", () => {
    const r = applyTaskDeltas(
      stats,
      task({ duration_minutes: 60 }),
      "user",
      PREFS,
      now
    );
    expect(r.deltas.hunger).toBe(2);
  });

  it("hunger from estimate: 8h → +5", () => {
    const r = applyTaskDeltas(
      stats,
      task({ duration_minutes: 480 }),
      "user",
      PREFS,
      now
    );
    expect(r.deltas.hunger).toBe(5);
  });

  it("base happiness +2 + priority bonus (p4=+1 → total +3)", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p4" }),
      "user",
      PREFS,
      now
    );
    expect(r.deltas.happiness).toBe(2 + 1);
  });

  it("p1 happiness: +2 base + 4 priority = +6", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p1" }),
      "user",
      PREFS,
      now
    );
    expect(r.deltas.happiness).toBe(2 + 4);
  });

  it("+5 happiness when completed on or before scheduled_date", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p3", scheduled_date: "2026-05-05" }),
      "user",
      PREFS,
      now
    );
    expect(r.deltas.happiness).toBe(2 + 2 + 5);
  });

  it("+5 happiness when completed on or before deadline_date", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p3", deadline_date: "2026-05-10" }),
      "user",
      PREFS,
      now
    );
    expect(r.deltas.happiness).toBe(2 + 2 + 5);
  });

  it("overdue: no on-time bonus, no penalty (still net positive)", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p3", deadline_date: "2026-04-25" }),
      "user",
      PREFS,
      now
    );
    expect(r.deltas.happiness).toBe(2 + 2);
  });

  it("energy delta is always 0 from completion (energy comes from creates/edits)", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p1", duration_minutes: 5 }),
      "user",
      PREFS,
      now
    );
    expect(r.deltas.energy).toBe(0);
  });

  it("p1 done: xp +50", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p1" }),
      "user",
      PREFS,
      now
    );
    expect(r.deltas.xp).toBe(50);
  });

  it("non-p1 done: xp +5", () => {
    for (const p of ["p2", "p3", "p4"] as const) {
      const r = applyTaskDeltas(
        stats,
        task({ priority: p }),
        "user",
        PREFS,
        now
      );
      expect(r.deltas.xp).toBe(5);
    }
  });

  it("actor=claude: narrative tagged accordingly", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p2" }),
      "claude",
      PREFS,
      now
    );
    expect(r.narrative_hint).toMatch(/claude/i);
  });
});

describe("hungerFromEstimate", () => {
  it.each([
    [null, 1],
    [30, 1],
    [31, 2],
    [60, 2],
    [120, 3],
    [240, 4],
    [480, 5],
    [960, 6],
    [9999, 6],
  ])("%p minutes → +%p hunger", (minutes, expected) => {
    expect(hungerFromEstimate(minutes)).toBe(expected);
  });
});

describe("priorityHappinessBonus", () => {
  it("p4=+1, p3=+2, p2=+3, p1=+4", () => {
    expect(priorityHappinessBonus("p4")).toBe(1);
    expect(priorityHappinessBonus("p3")).toBe(2);
    expect(priorityHappinessBonus("p2")).toBe(3);
    expect(priorityHappinessBonus("p1")).toBe(4);
  });
});

describe("applyCreateEnergy", () => {
  it("plain task (no rich metadata): +5", () => {
    const r = applyCreateEnergy({
      priority: "p4",
      duration_minutes: null,
      description: null,
    });
    expect(r.energy).toBe(5);
  });

  it("rich task with effort + non-default priority: +10", () => {
    const r = applyCreateEnergy({
      priority: "p2",
      duration_minutes: 60,
      description: null,
    });
    expect(r.energy).toBe(10);
  });

  it("priority alone (no estimate) is NOT enough — still +5", () => {
    const r = applyCreateEnergy({
      priority: "p2",
      duration_minutes: null,
      description: null,
    });
    expect(r.energy).toBe(5);
  });

  it("estimate alone (priority p4) is NOT enough — still +5", () => {
    const r = applyCreateEnergy({
      priority: "p4",
      duration_minutes: 60,
      description: null,
    });
    expect(r.energy).toBe(5);
  });

  it("description alone is enough for +10", () => {
    const r = applyCreateEnergy({
      priority: "p4",
      duration_minutes: null,
      description: "Some notes",
    });
    expect(r.energy).toBe(10);
  });

  it("doesn't stack past +10 (the cap)", () => {
    const r = applyCreateEnergy({
      priority: "p1",
      duration_minutes: 60,
      description: "notes",
    });
    expect(r.energy).toBe(10);
  });

  it("empty/whitespace description is treated as unset", () => {
    const r = applyCreateEnergy({
      priority: "p4",
      duration_minutes: null,
      description: "   ",
    });
    expect(r.energy).toBe(5);
  });
});

describe("applyEditEnergy", () => {
  it("filling one unset field: +1", () => {
    const r = applyEditEnergy(
      { priority: "p4", description: null },
      { priority: "p4", description: "added notes" }
    );
    expect(r.energy).toBe(1);
    expect(r.filledFields).toEqual(["description"]);
  });

  it("filling two unset fields in one edit: +2", () => {
    const r = applyEditEnergy(
      { priority: "p4", duration_minutes: null, scheduled_date: null },
      { priority: "p4", duration_minutes: 60, scheduled_date: "2026-05-05" }
    );
    expect(r.energy).toBe(2);
  });

  it("editing an already-set field: 0", () => {
    const r = applyEditEnergy(
      { description: "old notes" },
      { description: "new notes" }
    );
    expect(r.energy).toBe(0);
  });

  it("priority p4 → p2 counts as first-time fill", () => {
    const r = applyEditEnergy({ priority: "p4" }, { priority: "p2" });
    expect(r.energy).toBe(1);
    expect(r.filledFields).toContain("priority");
  });

  it("priority p2 → p1 (both 'filled') gives 0", () => {
    const r = applyEditEnergy({ priority: "p2" }, { priority: "p1" });
    expect(r.energy).toBe(0);
  });

  it("setting tags for the first time: +1", () => {
    const r = applyEditEnergy({ tags: [] }, { tags: ["focus"] });
    expect(r.energy).toBe(1);
  });

  it("adding more tags to an already-tagged task: 0", () => {
    const r = applyEditEnergy({ tags: ["a"] }, { tags: ["a", "b"] });
    expect(r.energy).toBe(0);
  });

  it("clearing a field (set → unset) does not subtract energy", () => {
    const r = applyEditEnergy(
      { description: "notes" },
      { description: null }
    );
    expect(r.energy).toBe(0);
  });
});

describe("isFieldFilled", () => {
  it("null/undefined are unfilled", () => {
    expect(isFieldFilled("description", null)).toBe(false);
    expect(isFieldFilled("description", undefined)).toBe(false);
  });

  it("priority p4 is unfilled (default); p1/p2/p3 are filled", () => {
    expect(isFieldFilled("priority", "p4")).toBe(false);
    expect(isFieldFilled("priority", "p3")).toBe(true);
    expect(isFieldFilled("priority", "p2")).toBe(true);
    expect(isFieldFilled("priority", "p1")).toBe(true);
  });

  it("empty/whitespace strings are unfilled", () => {
    expect(isFieldFilled("description", "")).toBe(false);
    expect(isFieldFilled("description", "   ")).toBe(false);
    expect(isFieldFilled("description", "actual notes")).toBe(true);
  });

  it("empty arrays are unfilled", () => {
    expect(isFieldFilled("tags", [])).toBe(false);
    expect(isFieldFilled("tags", ["a"])).toBe(true);
  });

  it("numbers: 0 and finite values are filled, NaN is not", () => {
    expect(isFieldFilled("duration_minutes", 0)).toBe(true);
    expect(isFieldFilled("duration_minutes", 30)).toBe(true);
    expect(isFieldFilled("duration_minutes", NaN)).toBe(false);
  });
});
