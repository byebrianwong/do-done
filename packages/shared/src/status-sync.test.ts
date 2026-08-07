import { describe, it, expect } from "vitest";
import {
  DEFAULT_STATUS_SYNC,
  backfilledScheduledDate,
  describeStatusSyncHorizon,
  isStatusSyncActive,
  parseStatusSyncSettings,
  promotedStatus,
  resolveStatusSyncHorizon,
  statusSyncPatch,
  statusesBelow,
  type StatusSyncSettings,
} from "./status-sync.js";

// Wed 2026-06-17.
const TODAY = "2026-06-17";

function settings(patch: Partial<StatusSyncSettings> = {}): StatusSyncSettings {
  return { ...DEFAULT_STATUS_SYNC, ...patch };
}

const both = (patch: Partial<StatusSyncSettings> = {}) =>
  settings({ status_sync_promote: true, status_sync_backfill: true, ...patch });

describe("settings parsing", () => {
  it("defaults to both halves off", () => {
    expect(DEFAULT_STATUS_SYNC.status_sync_promote).toBe(false);
    expect(DEFAULT_STATUS_SYNC.status_sync_backfill).toBe(false);
    expect(isStatusSyncActive(DEFAULT_STATUS_SYNC)).toBe(false);
  });

  it("falls back to defaults for a pre-migration row missing the columns", () => {
    expect(parseStatusSyncSettings({ timezone: "UTC" })).toEqual(
      DEFAULT_STATUS_SYNC
    );
    expect(parseStatusSyncSettings(null)).toEqual(DEFAULT_STATUS_SYNC);
  });

  it("reads the columns off a full preferences row", () => {
    const parsed = parseStatusSyncSettings({
      timezone: "UTC",
      status_sync_promote: true,
      status_sync_backfill: false,
      status_sync_status: "in_progress",
      status_sync_horizon_kind: "quick",
      status_sync_horizon_days: 3,
      status_sync_horizon_key: "this_weekend",
    });
    expect(parsed.status_sync_promote).toBe(true);
    expect(parsed.status_sync_status).toBe("in_progress");
    expect(parsed.status_sync_horizon_key).toBe("this_weekend");
  });

  it("rejects a nonsense status rather than half-applying the row", () => {
    // A bad value can only come from a hand-edited DB; falling back whole keeps
    // the rules from running against a target rank that doesn't exist.
    expect(
      parseStatusSyncSettings({ status_sync_status: "done" })
    ).toEqual(DEFAULT_STATUS_SYNC);
  });
});

describe("resolveStatusSyncHorizon", () => {
  it("counts days forward from the given day", () => {
    expect(
      resolveStatusSyncHorizon(settings({ status_sync_horizon_days: 3 }), TODAY)
    ).toBe("2026-06-20");
    expect(
      resolveStatusSyncHorizon(settings({ status_sync_horizon_days: 0 }), TODAY)
    ).toBe(TODAY);
  });

  it("crosses a month boundary", () => {
    expect(
      resolveStatusSyncHorizon(
        settings({ status_sync_horizon_days: 5 }),
        "2026-06-29"
      )
    ).toBe("2026-07-04");
  });

  it("resolves weekday-anchored keys off the given day, not the clock", () => {
    const weekend = settings({
      status_sync_horizon_kind: "quick",
      status_sync_horizon_key: "this_weekend",
    });
    expect(resolveStatusSyncHorizon(weekend, TODAY)).toBe("2026-06-21"); // Sun
    const week = settings({
      status_sync_horizon_kind: "quick",
      status_sync_horizon_key: "this_week",
    });
    expect(resolveStatusSyncHorizon(week, TODAY)).toBe("2026-06-19"); // Fri
  });

  it("describes itself for settings copy", () => {
    expect(describeStatusSyncHorizon(settings({ status_sync_horizon_days: 3 }))).toBe(
      "3 days"
    );
    expect(describeStatusSyncHorizon(settings({ status_sync_horizon_days: 1 }))).toBe(
      "1 day"
    );
    expect(describeStatusSyncHorizon(settings({ status_sync_horizon_days: 0 }))).toBe(
      "today"
    );
    expect(
      describeStatusSyncHorizon(
        settings({
          status_sync_horizon_kind: "quick",
          status_sync_horizon_key: "this_weekend",
        })
      )
    ).toBe("this weekend");
  });
});

describe("statusesBelow", () => {
  it("names every status the target may be promoted from", () => {
    expect(statusesBelow("next")).toEqual(["inbox", "later", "not_started"]);
    expect(statusesBelow("later")).toEqual(["inbox"]);
  });

  it("never includes the target or anything past it", () => {
    expect(statusesBelow("in_progress")).not.toContain("done");
    expect(statusesBelow("in_progress")).not.toContain("in_progress");
  });
});

describe("promotedStatus (date → status)", () => {
  const horizon = "2026-06-20"; // today + 3
  const on = settings({ status_sync_promote: true });

  it("promotes a task scheduled inside the horizon", () => {
    expect(
      promotedStatus({ status: "not_started", scheduled_date: "2026-06-19" }, on, horizon)
    ).toBe("next");
  });

  it("promotes on the horizon day itself (inclusive)", () => {
    expect(
      promotedStatus({ status: "inbox", scheduled_date: horizon }, on, horizon)
    ).toBe("next");
  });

  it("promotes an overdue task — nothing is nearer than late", () => {
    expect(
      promotedStatus({ status: "later", scheduled_date: "2026-01-01" }, on, horizon)
    ).toBe("next");
  });

  it("leaves a task scheduled past the horizon alone", () => {
    expect(
      promotedStatus({ status: "not_started", scheduled_date: "2026-06-21" }, on, horizon)
    ).toBeNull();
  });

  it("leaves an undated task alone", () => {
    expect(
      promotedStatus({ status: "not_started", scheduled_date: null }, on, horizon)
    ).toBeNull();
  });

  it("never moves a task backwards", () => {
    for (const status of ["next", "in_progress", "done", "cancelled"] as const) {
      expect(
        promotedStatus({ status, scheduled_date: "2026-06-18" }, on, horizon)
      ).toBeNull();
    }
  });

  it("does nothing when the promote half is off", () => {
    expect(
      promotedStatus(
        { status: "not_started", scheduled_date: "2026-06-18" },
        settings({ status_sync_backfill: true }),
        horizon
      )
    ).toBeNull();
  });
});

describe("backfilledScheduledDate (status → date)", () => {
  const horizon = "2026-06-20";
  const on = settings({ status_sync_backfill: true });

  it("dates an undated task at the target status", () => {
    expect(
      backfilledScheduledDate({ status: "next", scheduled_date: null }, on, horizon)
    ).toBe(horizon);
  });

  it("pulls in a task scheduled beyond the horizon", () => {
    expect(
      backfilledScheduledDate({ status: "next", scheduled_date: "2026-08-01" }, on, horizon)
    ).toBe(horizon);
  });

  it("leaves a date already inside the horizon alone", () => {
    expect(
      backfilledScheduledDate({ status: "next", scheduled_date: "2026-06-18" }, on, horizon)
    ).toBeNull();
  });

  it("leaves an overdue task's date alone — it is already nearer than the horizon", () => {
    expect(
      backfilledScheduledDate({ status: "next", scheduled_date: "2026-05-01" }, on, horizon)
    ).toBeNull();
  });

  it("also fires past the target — starting is a commitment too", () => {
    expect(
      backfilledScheduledDate({ status: "in_progress", scheduled_date: null }, on, horizon)
    ).toBe(horizon);
  });

  it("ignores statuses below the target", () => {
    for (const status of ["inbox", "later", "not_started"] as const) {
      expect(
        backfilledScheduledDate({ status, scheduled_date: null }, on, horizon)
      ).toBeNull();
    }
  });

  it("never dates a finished or cancelled task", () => {
    for (const status of ["done", "cancelled"] as const) {
      expect(
        backfilledScheduledDate({ status, scheduled_date: null }, on, horizon)
      ).toBeNull();
    }
  });
});

describe("statusSyncPatch (write time)", () => {
  const horizon = "2026-06-20";

  it("is empty when both halves are off", () => {
    expect(
      statusSyncPatch({
        prior: { status: "not_started", scheduled_date: "2026-06-18" },
        patch: { status: "next" },
        settings: DEFAULT_STATUS_SYNC,
        horizonISO: horizon,
      })
    ).toEqual({});
  });

  it("dates a task the moment it is moved to the target status", () => {
    expect(
      statusSyncPatch({
        prior: { status: "not_started", scheduled_date: null },
        patch: { status: "next" },
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({ scheduled_date: horizon });
  });

  it("promotes a task the moment it is given a near date", () => {
    expect(
      statusSyncPatch({
        prior: { status: "not_started", scheduled_date: null },
        patch: { scheduled_date: "2026-06-18" },
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({ status: "next" });
  });

  it("lets an explicit date in the same write beat backfill", () => {
    expect(
      statusSyncPatch({
        prior: { status: "not_started", scheduled_date: null },
        patch: { status: "next", scheduled_date: "2026-09-01" },
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({});
  });

  it("keeps a deliberate demotion from sticking while the date stays near", () => {
    // Both fields are returned: the status snaps back, so the write is visibly
    // refused rather than quietly undone by a later sweep.
    expect(
      statusSyncPatch({
        prior: { status: "next", scheduled_date: "2026-06-18" },
        patch: { status: "not_started" },
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({ status: "next" });
  });

  it("lets a demotion stand once the date moves out of the horizon", () => {
    expect(
      statusSyncPatch({
        prior: { status: "next", scheduled_date: "2026-06-18" },
        patch: { status: "not_started", scheduled_date: "2026-09-01" },
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({});
  });

  it("does not re-date a task on the way to done", () => {
    expect(
      statusSyncPatch({
        prior: { status: "next", scheduled_date: null },
        patch: { status: "done" },
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({});
  });

  it("reads the prior row for the field the patch does not touch", () => {
    // Renaming a task must not drag its status along with it.
    expect(
      statusSyncPatch({
        prior: { status: "not_started", scheduled_date: "2026-09-01" },
        patch: {},
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({});
  });

  it("still promotes on an unrelated write when the day has caught up", () => {
    expect(
      statusSyncPatch({
        prior: { status: "not_started", scheduled_date: "2026-06-18" },
        patch: {},
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({ status: "next" });
  });

  it("treats a create with no prior row as an inbox task", () => {
    expect(
      statusSyncPatch({
        prior: null,
        patch: { scheduled_date: "2026-06-18" },
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({ status: "next" });
  });

  it("backfills then promotes in one pass when a create names only a status", () => {
    expect(
      statusSyncPatch({
        prior: null,
        patch: { status: "next" },
        settings: both({ status_sync_status: "in_progress" }),
        horizonISO: horizon,
      })
    ).toEqual({});
    // ...and when the created status does reach the target, the date lands and
    // the status is already there, so only the date comes back.
    expect(
      statusSyncPatch({
        prior: null,
        patch: { status: "next" },
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({ scheduled_date: horizon });
  });

  it("clearing the date releases the task from the rule", () => {
    expect(
      statusSyncPatch({
        prior: { status: "not_started", scheduled_date: "2026-06-18" },
        patch: { scheduled_date: null },
        settings: both(),
        horizonISO: horizon,
      })
    ).toEqual({});
  });
});
