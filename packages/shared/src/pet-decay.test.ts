import { describe, it, expect } from "vitest";
import {
  computeCurrentStats,
  deriveMood,
  applyTaskDeltas,
  HUNGER_DECAY_PER_HOUR,
  HAPPINESS_DECAY_PER_HOUR,
  ENERGY_DECAY_PER_HOUR,
  type PetStatsSnapshot,
  type CurrentStats,
  type TaskDeltaProps,
} from "./pet-decay.js";

const NY = "America/New_York";

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
  const base = snapshot(80, 80, 80, "2026-05-01T12:00:00Z");

  it("zero hours: stats unchanged", () => {
    const stats = computeCurrentStats(base, new Date("2026-05-01T12:00:00Z"));
    expect(stats).toEqual({ hunger: 80, happiness: 80, energy: 80 });
  });

  it("1 hour: drops by hourly decay rates, integer rounded", () => {
    const stats = computeCurrentStats(base, new Date("2026-05-01T13:00:00Z"));
    expect(stats.hunger).toBe(80 - HUNGER_DECAY_PER_HOUR);
    expect(stats.happiness).toBe(80 - HAPPINESS_DECAY_PER_HOUR);
    // 80 - 1.5 = 78.5 → rounded to 79 (banker's: Math.round → 79).
    expect(stats.energy).toBe(Math.round(80 - ENERGY_DECAY_PER_HOUR));
  });

  it("24 hours of decay", () => {
    const stats = computeCurrentStats(base, new Date("2026-05-02T12:00:00Z"));
    expect(stats.hunger).toBe(Math.round(80 - 24 * HUNGER_DECAY_PER_HOUR)); // 32
    expect(stats.happiness).toBe(Math.round(80 - 24 * HAPPINESS_DECAY_PER_HOUR)); // 56
    expect(stats.energy).toBe(Math.round(80 - 24 * ENERGY_DECAY_PER_HOUR)); // 44
  });

  it("100 hours: clamps to zero, never negative", () => {
    const stats = computeCurrentStats(base, new Date("2026-05-05T16:00:00Z"));
    expect(stats.hunger).toBe(0);
    expect(stats.happiness).toBe(0);
    expect(stats.energy).toBe(0);
  });

  it("clamps high values to 100 (negative elapsed → no boost)", () => {
    // last_seen_at is in the future relative to `now`; we clamp elapsed to 0.
    const future = snapshot(100, 100, 100, "2026-05-10T00:00:00Z");
    const stats = computeCurrentStats(future, new Date("2026-05-01T00:00:00Z"));
    expect(stats).toEqual({ hunger: 100, happiness: 100, energy: 100 });
  });

  it("returns integers", () => {
    const stats = computeCurrentStats(
      snapshot(95, 95, 95, "2026-05-01T12:00:00Z"),
      new Date("2026-05-01T12:23:00Z") // 23 minutes
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
      last_seen_at: new Date("2026-05-01T12:00:00Z"),
    };
    const stats = computeCurrentStats(snap, new Date("2026-05-01T13:00:00Z"));
    expect(stats.hunger).toBe(78);
  });
});

describe("deriveMood", () => {
  const noon = new Date("2026-05-01T16:00:00Z"); // noon ET (EDT = UTC-4 in May)
  const midnight = new Date("2026-05-02T04:00:00Z"); // midnight ET

  function stats(h: number, ha: number, e: number): CurrentStats {
    return { hunger: h, happiness: ha, energy: e };
  }

  it("hungry when hunger < 30", () => {
    expect(deriveMood(stats(20, 80, 80), null, NY, noon)).toBe("hungry");
  });

  it("tired when energy < 30 (and hunger ok)", () => {
    expect(deriveMood(stats(80, 80, 20), null, NY, noon)).toBe("tired");
  });

  it("sad when happiness < 30 (and hunger/energy ok)", () => {
    expect(deriveMood(stats(80, 20, 80), null, NY, noon)).toBe("sad");
  });

  it("happy when sum >= 200", () => {
    expect(deriveMood(stats(70, 70, 70), null, NY, noon)).toBe("happy");
  });

  it("content as default (sum < 200, no individual <30)", () => {
    expect(deriveMood(stats(50, 50, 50), null, NY, noon)).toBe("content");
  });

  it("sleeping when idle > 8h AND nighttime", () => {
    // Last activity was 16h ago; current local time is ~midnight.
    const idle = new Date("2026-05-01T12:00:00Z");
    expect(deriveMood(stats(80, 80, 80), idle, NY, midnight)).toBe("sleeping");
  });

  it("not sleeping if daytime even when idle > 8h", () => {
    const idle = new Date("2026-05-01T00:00:00Z"); // 16h before noon
    // Stats sum 240 → would otherwise be happy.
    expect(deriveMood(stats(80, 80, 80), idle, NY, noon)).toBe("happy");
  });

  it("not sleeping if idle <= 8h even at night", () => {
    const idle = new Date("2026-05-02T00:00:00Z"); // 4h before midnight ET
    // Stats sum 150 → otherwise content.
    expect(deriveMood(stats(50, 50, 50), idle, NY, midnight)).toBe("content");
  });

  it("hungry takes priority over tired/sad", () => {
    expect(deriveMood(stats(10, 10, 10), null, NY, noon)).toBe("hungry");
  });

  it("tired takes priority over sad", () => {
    expect(deriveMood(stats(50, 10, 10), null, NY, noon)).toBe("tired");
  });
});

describe("applyTaskDeltas", () => {
  const stats: CurrentStats = { hunger: 50, happiness: 50, energy: 50 };
  // Use a fixed "now" so due_date comparisons are deterministic.
  const now = new Date("2026-05-01T12:00:00Z");

  function task(overrides: Partial<TaskDeltaProps> = {}): TaskDeltaProps {
    return {
      priority: "p3",
      due_date: null,
      duration_minutes: null,
      ...overrides,
    };
  }

  it("p1 done: hunger +20, happiness +15, xp +50", () => {
    const r = applyTaskDeltas(stats, task({ priority: "p1" }), "user", now);
    expect(r.deltas.hunger).toBe(20);
    expect(r.deltas.happiness).toBe(15);
    expect(r.deltas.xp).toBe(50);
    expect(r.deltas.energy).toBe(0);
  });

  it("p4 done: hunger +5, xp +5", () => {
    const r = applyTaskDeltas(stats, task({ priority: "p4" }), "user", now);
    expect(r.deltas.hunger).toBe(5);
    expect(r.deltas.xp).toBe(5);
    expect(r.deltas.happiness).toBe(0);
    expect(r.deltas.energy).toBe(0);
  });

  it("p2/p3 done: hunger +15 (default any-task)", () => {
    const r = applyTaskDeltas(stats, task({ priority: "p2" }), "user", now);
    expect(r.deltas.hunger).toBe(15);
  });

  it("quick task (<15min): energy +8 stacks with priority", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p1", duration_minutes: 10 }),
      "user",
      now
    );
    expect(r.deltas.energy).toBe(8);
    expect(r.deltas.hunger).toBe(20); // p1 base preserved
  });

  it("done before due date: happiness +10", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p3", due_date: "2026-05-05" }),
      "user",
      now
    );
    expect(r.deltas.happiness).toBe(10);
  });

  it("overdue task done: full hunger credit, no happiness penalty (Finch model)", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p3", due_date: "2026-04-25" }),
      "user",
      now
    );
    expect(r.deltas.hunger).toBe(15); // base preserved
    expect(r.deltas.happiness).toBe(0); // no penalty for being late
  });

  it("overdue p4: still net positive, never negative", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p4", due_date: "2026-04-25" }),
      "user",
      now
    );
    expect(r.deltas.hunger).toBe(5);
    expect(r.deltas.happiness).toBe(0);
    expect(r.deltas.energy).toBe(0);
  });

  it("p1 + on-time + quick: stacks all bonuses", () => {
    const r = applyTaskDeltas(
      stats,
      task({ priority: "p1", due_date: "2026-05-10", duration_minutes: 5 }),
      "user",
      now
    );
    expect(r.deltas.hunger).toBe(20);
    expect(r.deltas.happiness).toBe(15 + 10);
    expect(r.deltas.energy).toBe(8);
    expect(r.deltas.xp).toBe(50);
  });

  it("actor=claude: narrative tagged accordingly", () => {
    const r = applyTaskDeltas(stats, task({ priority: "p2" }), "claude", now);
    expect(r.narrative_hint).toMatch(/claude/i);
    // Deltas same regardless of actor.
    expect(r.deltas.hunger).toBe(15);
  });

  it("actor=user: narrative tagged accordingly", () => {
    const r = applyTaskDeltas(stats, task({ priority: "p1" }), "user", now);
    expect(r.narrative_hint).toMatch(/p1/i);
  });

  it("actor=system: still produces a narrative", () => {
    const r = applyTaskDeltas(stats, task({ priority: "p3" }), "system", now);
    expect(r.narrative_hint.length).toBeGreaterThan(0);
  });

  it("duration exactly 15 min: NOT a quick task", () => {
    const r = applyTaskDeltas(
      stats,
      task({ duration_minutes: 15 }),
      "user",
      now
    );
    expect(r.deltas.energy).toBe(0);
  });
});
