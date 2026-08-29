import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppError from "./error";

describe("AppError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says the data is safe rather than implying the account is empty", () => {
    render(<AppError error={new Error("boom")} unstable_retry={() => {}} />);

    // The regression this whole change exists for: an unreachable server used
    // to render as "No tasks". The error state must contradict that reading.
    expect(screen.getByText(/Couldn’t load your tasks/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is lost/i)).toBeInTheDocument();
    expect(screen.getByText(/still there/i)).toBeInTheDocument();
  });

  it("retries through Next 16's unstable_retry, which re-fetches", async () => {
    // Deliberately not `reset`: that re-renders what the boundary already has,
    // and the thing that failed here was the fetch.
    const retry = vi.fn();
    render(<AppError error={new Error("boom")} unstable_retry={retry} />);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows the digest when Next supplies one, and nothing when it doesn't", () => {
    const { rerender } = render(
      <AppError error={new Error("boom")} unstable_retry={() => {}} />
    );
    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();

    const withDigest = Object.assign(new Error("boom"), { digest: "abc123" });
    rerender(<AppError error={withDigest} unstable_retry={() => {}} />);
    expect(screen.getByText(/Reference: abc123/)).toBeInTheDocument();
  });
});
