import { describe, it, expect } from "vitest";
import {
  partitionTaskPatch,
  summarizeFieldErrors,
  fieldLabel,
} from "./task-validation.js";
import { TASK_DESCRIPTION_MAX_LENGTH } from "./constants.js";

describe("partitionTaskPatch", () => {
  it("passes a wholly valid patch through untouched", () => {
    const { valid, invalid } = partitionTaskPatch({
      title: "Ship it",
      priority: "p1",
    });
    expect(valid).toEqual({ title: "Ship it", priority: "p1" });
    expect(invalid).toEqual({});
  });

  // The whole point: one bad field must not cost the user the good ones. When
  // the patch went to the server whole, an over-long note took the title and
  // priority down with it — and kept doing so on every later save.
  it("holds back only the offending field and lets its neighbours through", () => {
    const { valid, invalid } = partitionTaskPatch({
      title: "Ship it",
      priority: "p1",
      description: "x".repeat(TASK_DESCRIPTION_MAX_LENGTH + 1),
    });
    expect(valid).toEqual({ title: "Ship it", priority: "p1" });
    expect(Object.keys(invalid)).toEqual(["description"]);
  });

  it("explains an over-long field in the user's terms, not Zod's", () => {
    const { invalid } = partitionTaskPatch({
      description: "x".repeat(TASK_DESCRIPTION_MAX_LENGTH + 1),
    });
    // Names the field as the UI names it, and says what the ceiling is.
    expect(invalid.description).toContain("Notes");
    expect(invalid.description).toContain("50,000");
    expect(invalid.description).not.toContain("String must contain");
  });

  it("accepts a field sitting exactly on the limit", () => {
    const { valid, invalid } = partitionTaskPatch({
      description: "x".repeat(TASK_DESCRIPTION_MAX_LENGTH),
    });
    expect(invalid).toEqual({});
    expect(Object.keys(valid)).toEqual(["description"]);
  });

  it("keeps nulls, which are how the editors clear a field", () => {
    const { valid, invalid } = partitionTaskPatch({
      description: null,
      scheduled_date: null,
      project_id: null,
    });
    expect(invalid).toEqual({});
    expect(valid).toEqual({
      description: null,
      scheduled_date: null,
      project_id: null,
    });
  });

  it("catches a malformed date rather than letting the DB do it", () => {
    const { valid, invalid } = partitionTaskPatch({
      scheduled_date: "not-a-date",
      title: "Fine",
    });
    expect(valid).toEqual({ title: "Fine" });
    expect(invalid.scheduled_date).toContain("Scheduled date");
  });

  // Dropping a field the caller asked to write would be a worse failure than
  // letting the server refuse it.
  it("passes undeclared keys through rather than silently dropping them", () => {
    const { valid, invalid } = partitionTaskPatch({ something_new: 1 });
    expect(valid).toEqual({ something_new: 1 });
    expect(invalid).toEqual({});
  });
});

describe("summarizeFieldErrors", () => {
  it("has nothing to say when nothing failed", () => {
    expect(summarizeFieldErrors({})).toBeNull();
  });

  it("uses the single field's own message verbatim", () => {
    expect(summarizeFieldErrors({ description: "Notes is too long." })).toBe(
      "Notes is too long."
    );
  });

  it("names every field when several failed", () => {
    const summary = summarizeFieldErrors({ description: "a", title: "b" });
    expect(summary).toContain("Notes");
    expect(summary).toContain("Title");
  });
});

describe("fieldLabel", () => {
  it("uses the label the UI shows, not the column name", () => {
    expect(fieldLabel("description")).toBe("Notes");
    expect(fieldLabel("duration_minutes")).toBe("Estimate");
  });

  it("falls back to the raw name for anything unmapped", () => {
    expect(fieldLabel("mystery_column")).toBe("mystery_column");
  });
});
