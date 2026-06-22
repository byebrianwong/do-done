// Device-scoped visibility for the Pip pet panel.
//
// Stored in a cookie (not localStorage) so the server can read it during SSR
// and render the correct layout with no flash — hiding/showing a whole 320px
// column would visibly jump if we waited for a post-mount localStorage read.
//
// Per-device by design: "more screen real estate" is a property of the screen
// you're on (a wide monitor vs. a laptop), not your account — so unlike the
// display prefs it deliberately does not sync to the DB.

export const PIP_HIDDEN_COOKIE = "dodone_pip_hidden";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Read the preference on the client. Server reads via next/headers cookies(). */
export function readPipHiddenCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => c === `${PIP_HIDDEN_COOKIE}=1`);
}

/** Persist the preference on the client. */
export function writePipHiddenCookie(hidden: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = `${PIP_HIDDEN_COOKIE}=${
    hidden ? "1" : "0"
  }; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

// Window event any surface (command palette, etc.) can dispatch to flip the
// Pip panel's visibility. AppShell owns the state and listens for it — same
// decoupling pattern as OPEN_QUICK_ADD_EVENT.
export const TOGGLE_PIP_PANEL_EVENT = "do-done:toggle-pip-panel";

/** Convenience dispatcher so callers don't hand-roll the event. */
export function togglePipPanel(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TOGGLE_PIP_PANEL_EVENT));
}
