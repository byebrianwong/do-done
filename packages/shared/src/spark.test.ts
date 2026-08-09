import { describe, it, expect } from "vitest";
import {
  SPARK_COUNT,
  SPARK_EFFORT_MINUTES,
  SPARK_MS,
  sparkParticles,
  sparkReason,
  shouldSpark,
} from "./spark.js";

const plain = { priority: "p3" as const, duration_minutes: null };

describe("sparkReason — what earns a burst", () => {
  it("stays quiet for the ordinary task, which is most of them", () => {
    expect(sparkReason(plain)).toBeNull();
    expect(shouldSpark(plain)).toBe(false);
  });

  it("fires for high and above, and not for the rest", () => {
    // p2's label is literally "High", so "high+" is p1 and p2. p4 is not a
    // priority someone chose — it is the absence of one.
    expect(sparkReason({ ...plain, priority: "p1" })).toBe("priority");
    expect(sparkReason({ ...plain, priority: "p2" })).toBe("priority");
    expect(sparkReason({ ...plain, priority: "p3" })).toBeNull();
    expect(sparkReason({ ...plain, priority: "p4" })).toBeNull();
  });

  it("fires for two hours of work, at the boundary and above", () => {
    expect(
      sparkReason({ ...plain, duration_minutes: SPARK_EFFORT_MINUTES })
    ).toBe("effort");
    expect(sparkReason({ ...plain, duration_minutes: 480 })).toBe("effort");
    expect(
      sparkReason({ ...plain, duration_minutes: SPARK_EFFORT_MINUTES - 1 })
    ).toBeNull();
  });

  it("fires when the completion empties its section", () => {
    expect(sparkReason(plain, { openInSection: 1 })).toBe("last-in-section");
    expect(sparkReason(plain, { openInSection: 2 })).toBeNull();
  });

  it("fires when the completion finishes the project", () => {
    expect(sparkReason(plain, { openInProject: 1 })).toBe("project-finished");
    expect(sparkReason(plain, { openInProject: 3 })).toBeNull();
  });

  it("fires on a streak day", () => {
    expect(sparkReason(plain, { streakDay: true })).toBe("streak");
    expect(sparkReason(plain, { streakDay: false })).toBeNull();
  });

  it("lets finishing something outrank what finished it", () => {
    const big = { priority: "p1" as const, duration_minutes: 240 };
    // The moment is the project ending, not that the last task was a big P1.
    expect(sparkReason(big, { openInProject: 1, openInSection: 1 })).toBe(
      "project-finished"
    );
    expect(sparkReason(big, { openInSection: 1 })).toBe("last-in-section");
    expect(sparkReason(big, { streakDay: true })).toBe("streak");
    expect(sparkReason(big)).toBe("effort");
  });

  it("treats a missing count as 'this surface can't tell', not as one left", () => {
    // The inbox and search have no sections; they must fall through to the
    // other rules rather than reading absence as an empty section.
    expect(sparkReason(plain, { openInSection: null })).toBeNull();
    expect(sparkReason(plain, { openInSection: undefined })).toBeNull();
    expect(sparkReason(plain, { openInProject: null })).toBeNull();
    // …and a task with no project must never look like a finished one.
    expect(sparkReason(plain, { openInProject: 0 })).toBeNull();
  });

  it("never fires on a section that still has work in it", () => {
    expect(sparkReason(plain, { openInSection: 0 })).toBeNull();
  });
});

describe("sparkParticles — the fan", () => {
  const fan = sparkParticles();

  it("throws the requested number of particles", () => {
    expect(fan).toHaveLength(SPARK_COUNT);
    expect(sparkParticles(4)).toHaveLength(4);
  });

  it("is deterministic, so both surfaces throw the same burst", () => {
    expect(sparkParticles()).toEqual(fan);
  });

  it("aims upward, out of the row rather than into the one below", () => {
    // Every particle's peak is above the checkbox: gravity is a constant added
    // afterwards, so the raw arc has to clear it.
    const rising = fan.filter((p) => p.ty < 16);
    expect(rising.length).toBe(fan.length);
  });

  it("spreads across both sides of the checkbox", () => {
    expect(fan.some((p) => p.tx < -5)).toBe(true);
    expect(fan.some((p) => p.tx > 5)).toBe(true);
  });

  it("staggers so the burst scatters instead of stamping", () => {
    const delays = new Set(fan.map((p) => p.delay));
    expect(delays.size).toBeGreaterThan(1);
    // …but every particle is gone well inside its own lifetime.
    for (const p of fan) expect(p.delay).toBeLessThan(SPARK_MS / 2);
  });

  it("stays inside the row it is fired from", () => {
    // A 3px spark 48px out of a ~44px row would land on a neighbour.
    for (const p of fan) {
      expect(Math.abs(p.tx)).toBeLessThanOrEqual(50);
      expect(Math.abs(p.ty)).toBeLessThanOrEqual(50);
    }
  });
});
