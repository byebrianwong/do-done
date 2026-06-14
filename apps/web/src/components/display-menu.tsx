"use client";

import { useEffect, useRef, useState } from "react";
import {
  GROUP_OPTIONS,
  PRIORITY_CONFIG,
  SORT_OPTIONS,
  activeFilterCount,
  hasFlagFilter,
  isManualSort,
  selectedFilterValues,
  toggleFilterValue,
  toggleFlagFilter,
  toggleSortDir,
  withGroup,
  withSort,
  type DisplayConfig,
  type Project,
  type TaskPriority,
} from "@do-done/shared";

export interface DisplayMenuProps {
  config: DisplayConfig;
  onChange: (next: DisplayConfig) => void;
  onReset: () => void;
  isDefault: boolean;
  projects?: Project[];
  availableTags?: string[];
}

const PRIORITIES: TaskPriority[] = ["p1", "p2", "p3", "p4"];

export function DisplayMenu({
  config,
  onChange,
  onReset,
  isDefault,
  projects = [],
  availableTags = [],
}: DisplayMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sortField = config.sort[0]?.field ?? "manual";
  const sortDir = config.sort[0]?.dir ?? "asc";
  const filterCount = activeFilterCount(config);
  const selectedPriorities = selectedFilterValues(config, "priority");
  const selectedProjects = selectedFilterValues(config, "project");
  const selectedTags = selectedFilterValues(config, "tag");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M3 6h10M3 14h6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="15" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="9" cy="14" r="2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        Display
        {!isDefault ? (
          <span
            aria-hidden
            className="ml-0.5 h-1.5 w-1.5 rounded-full bg-indigo-500"
          />
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Display options"
          className="absolute right-0 top-full z-30 mt-2 w-[300px] overflow-hidden rounded-xl border border-neutral-200 bg-white p-3.5 shadow-[0_12px_24px_rgba(17,24,39,0.10),0_2px_6px_rgba(17,24,39,0.05)] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <Section label="Group by">
            <div className="flex flex-wrap gap-1.5">
              {GROUP_OPTIONS.map((g) => (
                <Pill
                  key={g.key}
                  active={config.group === g.key}
                  onClick={() => onChange(withGroup(config, g.key))}
                >
                  {g.label}
                </Pill>
              ))}
            </div>
          </Section>

          <Section label="Sort by">
            <div className="flex flex-wrap items-center gap-1.5">
              {SORT_OPTIONS.map((s) => (
                <Pill
                  key={s.field}
                  active={sortField === s.field}
                  onClick={() => onChange(withSort(config, s.field))}
                >
                  {s.label}
                </Pill>
              ))}
              {sortField !== "manual" ? (
                <button
                  type="button"
                  onClick={() => onChange(toggleSortDir(config))}
                  aria-label={sortDir === "asc" ? "Ascending" : "Descending"}
                  className="ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[11px] font-medium text-neutral-500 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
                >
                  {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
                </button>
              ) : null}
            </div>
            {!isManualSort(config) ? (
              <p className="mt-1.5 text-[11px] text-neutral-400">
                Drag-to-reorder is off while a sort is applied.
              </p>
            ) : null}
          </Section>

          <Section label={filterCount ? `Filter · ${filterCount}` : "Filter"}>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {PRIORITIES.map((p) => (
                  <Pill
                    key={p}
                    active={selectedPriorities.includes(p)}
                    accent={PRIORITY_CONFIG[p].color}
                    onClick={() => onChange(toggleFilterValue(config, "priority", p))}
                  >
                    {p.toUpperCase()}
                  </Pill>
                ))}
                <Pill
                  active={hasFlagFilter(config, "overdue")}
                  accent="#ef4444"
                  onClick={() => onChange(toggleFlagFilter(config, "overdue"))}
                >
                  Overdue
                </Pill>
              </div>

              {projects.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {projects.map((p) => (
                    <Pill
                      key={p.id}
                      active={selectedProjects.includes(p.id)}
                      accent={p.color}
                      onClick={() => onChange(toggleFilterValue(config, "project", p.id))}
                    >
                      {p.name}
                    </Pill>
                  ))}
                </div>
              ) : null}

              {availableTags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {availableTags.map((t) => (
                    <Pill
                      key={t}
                      active={selectedTags.includes(t)}
                      onClick={() => onChange(toggleFilterValue(config, "tag", t))}
                    >
                      #{t}
                    </Pill>
                  ))}
                </div>
              ) : null}
            </div>
          </Section>

          <div className="mt-1 flex items-center justify-between border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
            <Switch
              on={config.showCompleted}
              label="Show completed"
              onClick={() =>
                onChange({ ...config, showCompleted: !config.showCompleted })
              }
            />
          </div>

          {!isDefault ? (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={onReset}
                className="text-[12px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Reset to default
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function Pill({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={active && accent ? { color: accent, borderColor: accent } : undefined}
      className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
        active
          ? "border-indigo-300 bg-indigo-50/70 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300"
          : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
      }`}
    >
      {children}
    </button>
  );
}

function Switch({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex w-full items-center justify-between text-[13px] font-medium text-neutral-700 dark:text-neutral-200"
    >
      {label}
      <span
        className={`relative inline-block h-5 w-9 rounded-full transition-colors ${
          on ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-700"
        }`}
        aria-hidden
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            on ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
