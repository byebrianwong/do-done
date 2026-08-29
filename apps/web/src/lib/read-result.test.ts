import { describe, it, expect } from "vitest";
import { ReadError, must, mustRow, read, readRow } from "./read-result";

describe("must", () => {
  it("returns the data when the read succeeded", () => {
    expect(must({ data: [1, 2], error: null }, "your tasks")).toEqual([1, 2]);
  });

  it("returns an empty list that really is empty", () => {
    // The whole point: `[]` with no error is a real answer and must pass
    // through to the page's own empty state.
    expect(must({ data: [], error: null }, "your tasks")).toEqual([]);
  });

  it("throws when the read failed, even though data is []", () => {
    // This is the exact shape TasksApi returns on failure — `data: []` and a
    // non-null error. Reading only `data` is what rendered an outage as an
    // empty account.
    expect(() =>
      must({ data: [], error: new Error("JWT issued at future") }, "your tasks")
    ).toThrow(ReadError);
  });

  it("names the read and keeps the underlying error as the cause", () => {
    const cause = new Error("JWT issued at future");
    try {
      must({ data: [], error: cause }, "your tasks");
      expect.unreachable("must() should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReadError);
      expect((e as ReadError).message).toBe("Could not load your tasks");
      expect((e as ReadError).cause).toBe(cause);
    }
  });

  it("throws on a null row that failed, and passes one that is simply absent", () => {
    // The detail pages depend on this split: `null` with no error is a 404,
    // `null` with an error is an outage.
    expect(must({ data: null, error: null }, "this task")).toBeNull();
    expect(() => must({ data: null, error: new Error("nope") }, "this task")).toThrow(
      ReadError
    );
  });
});

describe("read", () => {
  it("unwraps a resolved read", async () => {
    await expect(read(Promise.resolve({ data: 7, error: null }), "x")).resolves.toBe(
      7
    );
  });

  it("rejects with ReadError when the read failed", async () => {
    await expect(
      read(Promise.resolve({ data: [], error: new Error("boom") }), "your tasks")
    ).rejects.toThrow(ReadError);
  });
});

describe("mustRow", () => {
  // Verified against live PostgREST: `.single()` over zero rows answers
  // HTTP 406 { code: "PGRST116", details: "The result contains 0 rows" }.
  const noRows = Object.assign(
    new Error("Cannot coerce the result to a single JSON object"),
    { code: "PGRST116", details: "The result contains 0 rows" }
  );

  it("reads a row that is there", () => {
    expect(mustRow({ data: { id: "t1" }, error: null }, "this task")).toEqual({
      id: "t1",
    });
  });

  it("returns null for a row that genuinely is not there", () => {
    // This must stay a 404, not an outage. `.single()` reports "found nothing"
    // as an error, so without this branch every missing task would render
    // "couldn't load" instead of "not found".
    expect(mustRow({ data: null, error: noRows }, "this task")).toBeNull();
  });

  it("throws for a read that actually failed", () => {
    const outage = Object.assign(new Error("JWT issued at future"), {
      code: "PGRST303",
    });
    expect(() => mustRow({ data: null, error: outage }, "this task")).toThrow(
      ReadError
    );
  });

  it("throws for an error carrying no code at all", () => {
    // A transport failure has no PostgREST code. Absent evidence of "no rows",
    // the honest answer is that the read failed.
    expect(() =>
      mustRow({ data: null, error: new Error("fetch failed") }, "this task")
    ).toThrow(ReadError);
  });

  it("readRow unwraps the same three cases", async () => {
    await expect(
      readRow(Promise.resolve({ data: { id: "t1" }, error: null }), "x")
    ).resolves.toEqual({ id: "t1" });
    await expect(
      readRow(Promise.resolve({ data: null, error: noRows }), "x")
    ).resolves.toBeNull();
    await expect(
      readRow(Promise.resolve({ data: null, error: new Error("boom") }), "x")
    ).rejects.toThrow(ReadError);
  });
});
