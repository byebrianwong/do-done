import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useQuickAddComposer } from "./use-quick-add-composer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const createMock = vi.fn(async (input: { title: string }) => ({
  data: { id: "t1", user_id: "u1", ...input },
  error: null,
}));

vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: async () => ({ create: createMock }),
}));

beforeEach(() => createMock.mockClear());

describe("useQuickAddComposer — expand to editor", () => {
  it("opens on a 'New task' draft when expanding an empty composer", async () => {
    const { result } = renderHook(() =>
      useQuickAddComposer({ status: "inbox" })
    );
    await act(async () => {
      await result.current.openEditor({ allowEmpty: true });
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toMatchObject({
      title: "New task",
      status: "inbox",
    });
    expect(result.current.handoffTask?.id).toBe("t1");
    expect(result.current.handoffIsDraft).toBe(true);
  });

  it("does nothing on an empty composer without allowEmpty", async () => {
    const { result } = renderHook(() => useQuickAddComposer({}));
    let returned: unknown = "x";
    await act(async () => {
      returned = await result.current.openEditor();
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(returned).toBeNull();
    expect(result.current.handoffTask).toBeNull();
    expect(result.current.handoffIsDraft).toBe(false);
  });

  it("uses the typed title (not the draft fallback) when there is input", async () => {
    const { result } = renderHook(() => useQuickAddComposer({}));
    act(() => result.current.setInput("Buy milk"));
    await act(async () => {
      await result.current.openEditor({ allowEmpty: true });
    });
    expect(createMock.mock.calls[0][0]).toMatchObject({ title: "Buy milk" });
    expect(result.current.handoffIsDraft).toBe(false);
  });

  it("clearHandoff resets the draft flag", async () => {
    const { result } = renderHook(() => useQuickAddComposer({}));
    await act(async () => {
      await result.current.openEditor({ allowEmpty: true });
    });
    expect(result.current.handoffIsDraft).toBe(true);
    act(() => result.current.clearHandoff());
    expect(result.current.handoffTask).toBeNull();
    expect(result.current.handoffIsDraft).toBe(false);
  });
});
