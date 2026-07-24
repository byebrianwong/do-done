"use client";

import { useEffect, useState } from "react";
import {
  PRIORITY_CONFIG,
  QUICK_SCHEDULE,
  resolveQuickSchedule,
} from "@do-done/shared";
import type { Project } from "@do-done/shared";
import { useBulkActions } from "@/lib/use-bulk-actions";
import { PRIORITY_OPTIONS } from "./task-edit-modal-v2";

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
  chevron: "M9 5l7 7-7 7",
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

function Divider() {
  return <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />;
}

const PILL_BASE = "rounded-md px-2 py-1 text-xs font-medium transition-colors";
const pillClass =
  "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700";

function MenuRow({
  icon,
  label,
  danger,
  expandable,
  expanded,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-expanded={expandable ? !!expanded : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
        danger
          ? "text-red-600 dark:text-red-400"
          : "text-neutral-800 dark:text-neutral-100"
      }`}
    >
      <span
        className={`shrink-0 ${
          danger
            ? "text-red-500 dark:text-red-400"
            : "text-neutral-400 dark:text-neutral-500"
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {expandable ? (
        <span
          className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${
            expanded ? "rotate-90" : ""
          }`}
        >
          <Icon d={ICON.chevron} className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </button>
  );
}

/**
 * Right-click accelerator for a multi-selection — the same actions the floating
 * bar exposes, in the context-menu shape people reach for on desktop. Rendered
 * (positioned + portalled) by the task row when a selected row is right-clicked
 * while ≥2 rows are selected. Every action applies to the whole selection.
 */
export function BulkActionMenu({
  count,
  projects = [],
  onClose,
}: {
  count: number;
  projects?: Project[];
  onClose: () => void;
}) {
  const actions = useBulkActions();
  const [section, setSection] = useState<"schedule" | "move" | "priority" | null>(
    null
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Run a bulk action then dismiss the menu (the action clears the selection).
  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  const toggle = (s: "schedule" | "move" | "priority") =>
    setSection((cur) => (cur === s ? null : s));

  return (
    <div
      role="menu"
      aria-label={`Actions for ${count} tasks`}
      className="w-60 select-none overflow-hidden rounded-xl border border-neutral-200 bg-white p-1.5 text-[13px] shadow-[0_12px_28px_rgba(17,24,39,0.14),0_3px_8px_rgba(17,24,39,0.08)] dark:border-neutral-800 dark:bg-neutral-950"
    >
      <div className="px-2 pb-1 pt-1 text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">
        {count} tasks selected
      </div>

      <Divider />

      <MenuRow
        icon={<Icon d={ICON.calendar} />}
        label="Schedule"
        expandable
        expanded={section === "schedule"}
        onClick={() => toggle("schedule")}
      />
      {section === "schedule" ? (
        <div className="px-1.5 pb-1">
          <div className="flex flex-wrap gap-1">
            {QUICK_SCHEDULE.map((q) => (
              <button
                key={q.key}
                type="button"
                role="menuitem"
                onClick={() => run(() => void actions.schedule(resolveQuickSchedule(q.key)))}
                className={`${PILL_BASE} ${pillClass}`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(() => void actions.schedule(null))}
            className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            × Clear schedule
          </button>
        </div>
      ) : null}

      <MenuRow
        icon={<FlagIcon color={PRIORITY_CONFIG.p2.color} filled />}
        label="Priority"
        expandable
        expanded={section === "priority"}
        onClick={() => toggle("priority")}
      />
      {section === "priority" ? (
        <div className="px-1.5 pb-1">
          {PRIORITY_OPTIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="menuitem"
              onClick={() => run(() => void actions.setPriority(p.value))}
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
      ) : null}

      <MenuRow
        icon={<Icon d={ICON.folder} />}
        label="Move to…"
        expandable
        expanded={section === "move"}
        onClick={() => toggle("move")}
      />
      {section === "move" ? (
        <div className="max-h-44 space-y-0.5 overflow-y-auto px-1.5 pb-1">
          <button
            type="button"
            role="menuitem"
            onClick={() => run(() => void actions.setProject(null))}
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
              onClick={() => run(() => void actions.setProject(p.id))}
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
      ) : null}

      <Divider />

      <MenuRow
        icon={<Icon d={ICON.check} />}
        label="Complete"
        onClick={() => run(() => void actions.complete())}
      />
      <MenuRow
        icon={<Icon d={ICON.trash} />}
        label={`Delete ${count} tasks`}
        danger
        onClick={() => run(() => void actions.remove())}
      />
    </div>
  );
}
