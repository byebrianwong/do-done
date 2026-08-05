"use client";

import { useEffect, useRef, useState } from "react";
import {
  PRIORITY_CONFIG,
  QUICK_SCHEDULE,
  resolveQuickSchedule,
} from "@do-done/shared";
import type { Project } from "@do-done/shared";
import { useTaskSelection } from "@/lib/task-selection";
import { useBulkActions } from "@/lib/use-bulk-actions";
import { PRIORITY_OPTIONS, useClickOutside } from "./task-edit-modal-v2";

// ── Icons ─────────────────────────────────────────────
// Hand-drawn to match the rest of the web app (no icon library).

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      className={className ?? "h-4 w-4"}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICON = {
  calendar:
    "M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
  folder: "M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  check: "M5 13l4 4L19 7",
  trash: "M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m-1 0v12a1 1 0 01-1 1H9a1 1 0 01-1-1V7",
  close: "M6 18L18 6M6 6l12 12",
} as const;

function FlagIcon({ color, filled }: { color: string; filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path d="M6 21V4" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <path
        d="M6 4.5h10.5l-2.2 3.4 2.2 3.4H6z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Building blocks ───────────────────────────────────

const ACTION_BTN =
  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-200 dark:hover:bg-neutral-800";

/** A bar action that opens an upward popover (Schedule / Move / Priority). */
function PopoverAction({
  label,
  icon,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Only the *open* popover may act on an outside click. The three popovers
  // here share one `menu` state (unlike every other menu in the app, which
  // owns a local `open`), so a closed sibling calling onOpenChange(false) sets
  // that shared state to null — and a mousedown inside the open popover is
  // "outside" to both its siblings. That unmounted the open popover between
  // mousedown and click, so the item's onClick never fired and Schedule /
  // Move / Priority silently did nothing.
  useClickOutside(ref, () => {
    if (open) onOpenChange(false);
  });
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={ACTION_BTN}
      >
        {icon}
        {label}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-[0_12px_28px_rgba(17,24,39,0.16),0_3px_8px_rgba(17,24,39,0.08)] dark:border-neutral-800 dark:bg-neutral-950"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

const PILL_BASE = "rounded-md px-2 py-1 text-xs font-medium transition-colors";
const pillClass =
  "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700";

/**
 * Floating bulk-action bar — the primary, discoverable surface for acting on a
 * multi-selection. Mounted once at the app shell; renders nothing until a row
 * is selected. Reads/writes selection via `useTaskSelection` + `useBulkActions`.
 */
export function BulkActionBar({ projects = [] }: { projects?: Project[] }) {
  const selection = useTaskSelection();
  const actions = useBulkActions();
  const [menu, setMenu] = useState<"schedule" | "move" | "priority" | null>(
    null
  );

  const count = selection.count;
  const active = count > 0;

  // Escape closes an open popover first; a second press (nothing open here, and
  // no other menu on screen) clears the whole selection.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) {
        setMenu(null);
        return;
      }
      // Defer to an open context menu (single or bulk) — it owns its own Escape.
      const otherMenu = document.querySelector('[role="menu"]');
      if (otherMenu) return;
      selection.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, menu, selection]);

  // Reset any open popover when the selection empties (e.g. after an action),
  // so re-selecting later never reveals a stale popover. Adjusting state during
  // render keeps this in sync without an extra commit.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setMenu(null);
  }

  if (!active) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
      data-bulk-bar
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-neutral-200 bg-white/95 p-1.5 shadow-[0_16px_40px_rgba(17,24,39,0.18),0_4px_10px_rgba(17,24,39,0.10)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <span className="flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[13px] font-semibold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-indigo-500 text-white">
            <Icon d={ICON.check} className="h-3 w-3" />
          </span>
          {count} selected
        </span>

        <div className="mx-0.5 h-6 w-px bg-neutral-200 dark:bg-neutral-800" />

        <PopoverAction
          label="Schedule"
          icon={<Icon d={ICON.calendar} />}
          open={menu === "schedule"}
          onOpenChange={(o) => setMenu(o ? "schedule" : null)}
        >
          <div className="flex flex-wrap gap-1 p-1">
            {QUICK_SCHEDULE.map((q) => (
              <button
                key={q.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  void actions.schedule(resolveQuickSchedule(q.key));
                }}
                className={`${PILL_BASE} ${pillClass}`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="p-1">
            <input
              type="date"
              aria-label="Pick a do-date"
              onChange={(e) => {
                if (e.target.value) void actions.schedule(e.target.value);
              }}
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-[13px] text-neutral-800 outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
            />
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void actions.schedule(null);
            }}
            className="mx-1 mb-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            × Clear schedule
          </button>
        </PopoverAction>

        <PopoverAction
          label="Move"
          icon={<Icon d={ICON.folder} />}
          open={menu === "move"}
          onOpenChange={(o) => setMenu(o ? "move" : null)}
        >
          <div className="max-h-56 space-y-0.5 overflow-y-auto p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void actions.setProject(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              <span className="h-2 w-2 shrink-0 rounded-full border border-neutral-300 dark:border-neutral-600" />
              <span className="flex-1 truncate">No project</span>
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  void actions.setProject(p.id);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="flex-1 truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </PopoverAction>

        <PopoverAction
          label="Priority"
          icon={
            <FlagIcon color={PRIORITY_CONFIG.p2.color} filled />
          }
          open={menu === "priority"}
          onOpenChange={(o) => setMenu(o ? "priority" : null)}
        >
          <div className="p-1">
            {PRIORITY_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="menuitem"
                onClick={() => {
                  void actions.setPriority(p.value);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                <FlagIcon
                  color={PRIORITY_CONFIG[p.value].color}
                  filled={p.value !== "p4"}
                />
                <span className="flex-1">{p.label}</span>
                <span className="text-[11px] text-neutral-400">{p.code}</span>
              </button>
            ))}
          </div>
        </PopoverAction>

        <button
          type="button"
          onClick={() => {
            void actions.complete();
          }}
          disabled={actions.pending}
          className={ACTION_BTN}
        >
          <Icon d={ICON.check} />
          Complete
        </button>

        <button
          type="button"
          onClick={() => {
            void actions.remove();
          }}
          disabled={actions.pending}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
        >
          <Icon d={ICON.trash} />
          Delete
        </button>

        <div className="mx-0.5 h-6 w-px bg-neutral-200 dark:bg-neutral-800" />

        <button
          type="button"
          onClick={() => selection.clear()}
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        >
          <Icon d={ICON.close} />
        </button>
      </div>
    </div>
  );
}
