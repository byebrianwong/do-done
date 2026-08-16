"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@do-done/shared";
import { SidebarNav } from "@/components/sidebar-nav";
import { PetPanelContainer } from "@/components/pet/PetPanelContainer";
import { PetRevealTab } from "@/components/pet/PetRevealTab";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/command-palette";
import {
  TOGGLE_PIP_PANEL_EVENT,
  writePipHiddenCookie,
} from "@/lib/pip-visibility";

/**
 * Responsive application shell.
 *
 * Desktop (>= md): the sidebar is permanently docked on the left (the
 * original layout) and the main column is offset by its width.
 *
 * Mobile (< md): the sidebar becomes an off-canvas drawer. A sticky top bar
 * exposes a hamburger to open it, the brand, and a search button that opens
 * the command palette (the only way to reach search/quick-nav without a
 * physical keyboard). The drawer slides in over a dimmed backdrop and closes
 * on backdrop tap, on the close button, or whenever the route changes.
 */
export function AppShell({
  projects,
  userEmail,
  hasPlaces = false,
  pipHidden = false,
  sidebarFooter,
  children,
}: {
  projects: Project[];
  userEmail: string | null;
  /** Whether to offer the Places view — see `SidebarNav`. */
  hasPlaces?: boolean;
  /**
   * Whether the Pip panel starts collapsed. Read server-side from a cookie so
   * the first paint already has the right layout (no flash). Device-scoped.
   */
  pipHidden?: boolean;
  /**
   * Replaces the account card at the foot of the sidebar. The demo puts its
   * "nothing here is saved" card there, in the slot the signed-in user's
   * address and sign-out button occupy in the real app.
   */
  sidebarFooter?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [petHidden, setPetHidden] = useState(pipHidden);

  const setPipHidden = useCallback((hidden: boolean) => {
    setPetHidden(hidden);
    writePipHiddenCookie(hidden);
  }, []);

  // Toggle the Pip panel from the keyboard ("p") or a window event (the
  // command palette's "Toggle Pip panel" action). Mirrors the global "q"
  // quick-add shortcut: ignore it while a modifier is held (so ⌘P print stays
  // native) or while focus is in a text field. Only active when there's a
  // panel to toggle (signed in).
  useEffect(() => {
    if (!userEmail) return;
    const toggle = () => setPipHidden(!petHidden);
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() !== "p") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(TOGGLE_PIP_PANEL_EVENT, toggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(TOGGLE_PIP_PANEL_EVENT, toggle);
    };
  }, [userEmail, petHidden, setPipHidden]);

  // Lock body scroll while the mobile drawer is open so the page behind it
  // doesn't scroll under the finger.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  function openCommandPalette() {
    window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
  }

  return (
    <div className="min-h-screen">
      {/* Mobile top bar — hidden on md+ where the sidebar is always visible. */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-neutral-200 bg-white/90 px-3 backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-950/90">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
        <span className="text-lg font-bold text-indigo-500">DoDone</span>
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="Search and commands"
          className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>
      </header>

      {/* Backdrop — only rendered (and only interactive) on mobile while the
          drawer is open. */}
      {drawerOpen ? (
        <div
          onClick={() => setDrawerOpen(false)}
          aria-hidden
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          data-testid="drawer-backdrop"
        />
      ) : (
        <div className="hidden" data-testid="drawer-backdrop-placeholder" />
      )}

      {/* Sidebar — off-canvas drawer on mobile, docked on md+. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 max-w-[85vw] flex-col border-r border-neutral-200 bg-neutral-50 transition-transform duration-200 ease-out md:translate-x-0 dark:border-neutral-800 dark:bg-neutral-900 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex h-14 items-center justify-between px-5">
          <span className="text-xl font-bold text-indigo-500">DoDone</span>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 md:hidden dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Tapping any nav link closes the drawer (mobile). Using a bubbled
            click keeps this out of an effect — the link still navigates. */}
        <div
          className="contents"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setDrawerOpen(false);
          }}
        >
          <SidebarNav projects={projects} hasPlaces={hasPlaces} />
        </div>

        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          {sidebarFooter}
          {userEmail && (
            <div className="mb-3 flex items-center gap-2 px-2 py-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500 text-xs font-semibold text-white">
                {(userEmail[0] ?? "?").toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  {userEmail}
                </p>
              </div>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                </button>
              </form>
            </div>
          )}
        </div>
      </aside>

      {/* Main column — offset by the sidebar only on md+. */}
      <div className="flex md:ml-64">
        <main className="min-w-0 flex-1">
          <div className="p-4 sm:p-6 lg:p-8">{children}</div>
        </main>

        {userEmail ? (
          petHidden ? (
            // Out of flow (fixed) so the main column reclaims the full width.
            // xl-only, matching where the panel itself lives.
            <div className="fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 xl:block">
              <PetRevealTab onShow={() => setPipHidden(false)} />
            </div>
          ) : (
            <PetPanelContainer
              onHide={() => setPipHidden(true)}
              className="border-l border-neutral-200 dark:border-neutral-800"
            />
          )
        ) : null}
      </div>
    </div>
  );
}
