import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  computeRangeSelection,
  TaskSelectionProvider,
  useTaskSelection,
} from "./task-selection";

// usePathname drives the reset-on-navigation effect; pin it so the provider
// mounts under jsdom without the real App Router.
vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}));

const ORDER = ["a", "b", "c", "d", "e"];

describe("computeRangeSelection", () => {
  it("returns just the target when there is no anchor", () => {
    expect(computeRangeSelection(null, "c", ORDER)).toEqual(["c"]);
  });

  it("selects a forward range inclusive of both ends", () => {
    expect(computeRangeSelection("b", "d", ORDER)).toEqual(["b", "c", "d"]);
  });

  it("selects a backward range in visual (not click) order", () => {
    expect(computeRangeSelection("d", "b", ORDER)).toEqual(["b", "c", "d"]);
  });

  it("handles a zero-length range (anchor === target)", () => {
    expect(computeRangeSelection("c", "c", ORDER)).toEqual(["c"]);
  });

  it("falls back to the target when the anchor is no longer visible", () => {
    expect(computeRangeSelection("zzz", "c", ORDER)).toEqual(["c"]);
  });
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <TaskSelectionProvider>{children}</TaskSelectionProvider>;
}

describe("TaskSelectionProvider", () => {
  it("toggles a row in and back out, tracking active state", () => {
    const { result } = renderHook(() => useTaskSelection(), { wrapper });

    expect(result.current.isActive).toBe(false);
    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(true);
    expect(result.current.count).toBe(1);
    expect(result.current.isActive).toBe(true);

    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it("extends a range from the last-toggled anchor", () => {
    const { result } = renderHook(() => useTaskSelection(), { wrapper });

    act(() => result.current.toggle("b")); // anchor = b
    act(() => result.current.selectRange("d", ORDER));

    expect([...result.current.selectedIds].sort()).toEqual(["b", "c", "d"]);
  });

  it("selectOnly collapses a multi-selection to one row", () => {
    const { result } = renderHook(() => useTaskSelection(), { wrapper });

    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("b"));
    expect(result.current.count).toBe(2);

    act(() => result.current.selectOnly("e"));
    expect([...result.current.selectedIds]).toEqual(["e"]);
  });

  it("resolves selected ids back to their registered Task objects", () => {
    const { result } = renderHook(() => useTaskSelection(), { wrapper });

    const taskA = { id: "a", title: "Alpha" } as never;
    const taskB = { id: "b", title: "Beta" } as never;
    act(() => {
      result.current.registerTask(taskA);
      result.current.registerTask(taskB);
      result.current.toggle("a");
    });

    const selected = result.current.getSelectedTasks();
    expect(selected).toEqual([taskA]);
  });

  it("clear() empties the selection", () => {
    const { result } = renderHook(() => useTaskSelection(), { wrapper });
    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("b"));
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
    expect(result.current.isActive).toBe(false);
  });
});
