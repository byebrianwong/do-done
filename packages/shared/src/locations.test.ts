import { describe, expect, it } from "vitest";
import {
  groupLinksByTask,
  locationReminderLabel,
  locationRowLabel,
  type TaskLocationLink,
  type TaskLocationLinkRow,
} from "./locations.js";
import type { Location, TriggerType } from "./schemas.js";

function place(id: string, name: string): Location {
  return {
    id,
    user_id: "u1",
    name,
    latitude: 51.5,
    longitude: -0.12,
    radius_meters: 200,
    address: null,
    is_saved: true,
    created_at: "2026-08-15T00:00:00.000Z",
    updated_at: "2026-08-15T00:00:00.000Z",
  };
}

function link(name: string, trigger: TriggerType, id = name): TaskLocationLink {
  return { location: place(id, name), trigger_type: trigger };
}

describe("locationReminderLabel", () => {
  it("invites when there is nothing attached", () => {
    expect(locationReminderLabel([])).toBe("Remind me at a place");
  });

  it("names the place and the direction for a single reminder", () => {
    expect(locationReminderLabel([link("Tesco", "enter")])).toBe(
      "Arriving at Tesco"
    );
    expect(locationReminderLabel([link("the office", "exit")])).toBe(
      "Leaving the office"
    );
  });

  it("keeps the name when both directions are set at one place", () => {
    expect(
      locationReminderLabel([link("Tesco", "enter"), link("Tesco", "exit")])
    ).toBe("Arriving at and leaving Tesco");
  });

  it("counts distinct places once naming one would be a lie", () => {
    expect(
      locationReminderLabel([link("Tesco", "enter"), link("Boots", "enter")])
    ).toBe("2 places");
  });
});

describe("locationRowLabel", () => {
  it("says nothing at all when there is no reminder", () => {
    expect(locationRowLabel([])).toBeNull();
  });

  it("names the place, without the direction a row has no width for", () => {
    expect(locationRowLabel([link("Tesco", "enter")])).toBe("Tesco");
    expect(
      locationRowLabel([link("Tesco", "enter"), link("Tesco", "exit")])
    ).toBe("Tesco");
  });

  it("counts past one place", () => {
    expect(
      locationRowLabel([link("Tesco", "enter"), link("Boots", "exit")])
    ).toBe("2 places");
  });
});

describe("groupLinksByTask", () => {
  it("buckets rows by task and drops the task id from the link", () => {
    const rows: TaskLocationLinkRow[] = [
      { task_id: "t1", ...link("Tesco", "enter") },
      { task_id: "t2", ...link("Boots", "exit") },
      { task_id: "t1", ...link("Tesco", "exit") },
    ];
    const grouped = groupLinksByTask(rows);

    expect([...grouped.keys()].sort()).toEqual(["t1", "t2"]);
    expect(grouped.get("t1")).toHaveLength(2);
    expect(grouped.get("t2")).toEqual([link("Boots", "exit")]);
    expect(grouped.get("t1")?.[0]).not.toHaveProperty("task_id");
  });

  it("is an empty map for an empty read", () => {
    expect(groupLinksByTask([]).size).toBe(0);
  });
});
