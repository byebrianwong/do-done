import { describe, it, expect, vi } from "vitest";
import { createEditorReconciler } from "./editor-reconcile";

type Row = { id: string; title: string };

function setup() {
  const patch = vi.fn();
  const invalidate = vi.fn();
  const afterClose = vi.fn();
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const r = createEditorReconciler<Row>({
    patch,
    invalidate,
    afterClose,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
    fallbackMs: 4000,
  });
  const fire = () => timers.filter((t) => !t.cleared).forEach((t) => t.fn());
  return { r, patch, invalidate, afterClose, timers, fire };
}

const row = (title: string): Row => ({ id: "a", title });

describe("createEditorReconciler", () => {
  it("patches each save and refetches nothing while the editor is open", () => {
    const { r, patch, invalidate } = setup();
    r.saved(row("b"));
    r.saved(row("bu"));
    r.saved(row("buy"));
    expect(patch).toHaveBeenCalledTimes(3);
    expect(patch).toHaveBeenLastCalledWith(row("buy"));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refetches once on close after saves have landed", () => {
    const { r, invalidate } = setup();
    r.saved(row("x"));
    r.saved(row("xy"));
    r.closed(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when the editor closes without saving anything", () => {
    const { r, invalidate, timers } = setup();
    r.closed(false);
    expect(invalidate).not.toHaveBeenCalled();
    expect(timers).toHaveLength(0);
  });

  it("waits for a save queued at close, so the refetch reads the new row", () => {
    const { r, patch, invalidate } = setup();
    r.closed(true);
    expect(invalidate).not.toHaveBeenCalled();
    r.saved(row("flushed"));
    expect(patch).toHaveBeenCalledWith(row("flushed"));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("cancels the fallback once the queued save lands", () => {
    const { r, invalidate, timers, fire } = setup();
    r.closed(true);
    r.saved(row("flushed"));
    expect(timers[0].cleared).toBe(true);
    fire();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("refetches after the fallback when the queued save never lands", () => {
    const { r, invalidate, timers, fire } = setup();
    r.saved(row("earlier"));
    r.closed(true);
    expect(timers[0].ms).toBe(4000);
    expect(invalidate).not.toHaveBeenCalled();
    fire();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("refetches for every save that lands after close", () => {
    const { r, invalidate } = setup();
    r.closed(true);
    r.saved(row("one"));
    r.saved(row("two"));
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("treats a second close as the same close", () => {
    const { r, invalidate } = setup();
    r.saved(row("x"));
    r.closed(false);
    r.closed(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("tells the host once, after the close settles, whether anything saved", () => {
    const a = setup();
    a.r.closed(false);
    expect(a.afterClose).toHaveBeenCalledWith(false);

    const b = setup();
    b.r.saved(row("x"));
    b.r.closed(false);
    expect(b.afterClose).toHaveBeenCalledTimes(1);
    expect(b.afterClose).toHaveBeenCalledWith(true);
  });

  it("tells the host only after a save queued at close has landed", () => {
    const { r, afterClose, invalidate } = setup();
    r.closed(true);
    expect(afterClose).not.toHaveBeenCalled();
    r.saved(row("flushed"));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(afterClose).toHaveBeenCalledTimes(1);
    expect(afterClose).toHaveBeenCalledWith(true);
    r.saved(row("again"));
    expect(afterClose).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("tells the host after the fallback when the queued save never lands", () => {
    const { r, afterClose, fire } = setup();
    r.closed(true);
    fire();
    expect(afterClose).toHaveBeenCalledTimes(1);
    expect(afterClose).toHaveBeenCalledWith(false);
  });
});
