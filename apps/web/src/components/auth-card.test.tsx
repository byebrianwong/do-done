import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthCard } from "./auth-card";

const signUp = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClientSupabase: () => ({
    auth: {
      signUp: (...args: unknown[]) => signUp(...args),
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signInWithOAuth: vi.fn(),
    },
  }),
}));

async function fillAndSubmitSignup() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Sign up" }));
  await user.type(screen.getByLabelText("Email"), "new@example.com");
  await user.type(screen.getByLabelText("Password"), "hunter22");
  await user.click(screen.getByRole("button", { name: "Sign up" }));
}

describe("AuthCard signup", () => {
  beforeEach(() => {
    signUp.mockReset().mockResolvedValue({ error: null });
    signInWithPassword.mockReset().mockResolvedValue({ error: null });
  });

  it("sends the confirmation link to the callback route, not the site root", async () => {
    render(<AuthCard next="/today" />);
    await fillAndSubmitSignup();

    // Left unset, Supabase falls back to the project's Site URL, which lands a
    // new account on a page that never exchanges the code for a session.
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Ftoday`,
        },
      })
    );
  });

  it("says to check your email, and says it as a notice rather than an error", async () => {
    render(<AuthCard />);
    await fillAndSubmitSignup();

    const message = await screen.findByText(
      "Check your email for a link to confirm your address."
    );
    // Signing up succeeded; nothing here may wear the failure styling.
    expect(message.className).not.toContain("red");
    // And it may not send anyone to a dashboard they don't have.
    expect(document.body.textContent).not.toMatch(/supabase/i);
  });
});
