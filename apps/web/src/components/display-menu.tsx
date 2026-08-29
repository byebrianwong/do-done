"use client";

import { useEffect, useRef, useState } from "react";
import {
  DENSITY_OPTIONS,
  GROUP_OPTIONS,
  ROW_STYLE_OPTIONS,
  OVERDUE_COLOR,
  PRIORITY_CONFIG,
  SORT_OPTIONS,
  activeFilterCount,
  withDensity,
  withRowStyle,
  hasFlagFilter,
  isManualSort,
  selectedFilterValues,
  toggleFilterValue,
  toggleFlagFilter,
  toggleGroupDir,
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
  const groupReversed = config.groupDir === "desc";
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
            <div className="flex flex-wrap items-center gap-1.5">
              {GROUP_OPTIONS.map((g) => (
                <Pill
                  key={g.key}
                  active={config.group === g.key}
                  onClick={() => onChange(withGroup(config, g.key))}
                >
                  {g.label}
                </Pill>
              ))}
              {config.group !== "none" ? (
                <button
                  type="button"
                  onClick={() => onChange(toggleGroupDir(config))}
                  aria-pressed={groupReversed}
                  aria-label={
                    groupReversed ? "Group order reversed" : "Reverse group order"
                  }
                  className={`ml-auto inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors ${
                    groupReversed
                      ? "border-indigo-300 bg-indigo-50/70 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300"
                      : "border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
                  }`}
                >
                  ⇅ Reverse
                </button>
              ) : null}
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
                Drag a task to switch to manual order.
              </p>
            ) : null}
          </Section>

          <Section label="Density">
            <div className="flex flex-wrap items-center gap-1.5">
              {DENSITY_OPTIONS.map((d) => (
                <Pill
                  key={d.key}
                  active={config.density === d.key}
                  title={d.hint}
                  onClick={() => onChange(withDensity(config, d.key))}
                >
                  {d.label}
                </Pill>
              ))}
            </div>
          </Section>

          {/* Beside Density because they are the same kind of setting: neither
              changes which tasks are in the list, only how much of the screen
              each one takes and how much of itself it states. */}
          <Section label="Row">
            <div className="flex flex-wrap items-center gap-1.5">
              {ROW_STYLE_OPTIONS.map((r) => (
                <Pill
                  key={r.key}
                  active={config.rowStyle === r.key}
                  title={r.hint}
                  onClick={() => onChange(withRowStyle(config, r.key))}
                >
                  {r.label}
                </Pill>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-400">
              {config.rowStyle === "quiet"
                ? "Details on one line. Colour is the project ring and the urgency mark."
                : "Each detail its own chip, and each chip an editor."}
            </p>
          </Section>

          <Section
            label={filterCount ? `Filter · ${filterCount}` : "Filter"}
            name="Filter"
          >
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
                  accent={OVERDUE_COLOR}
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

          <div className="mt-1 space-y-2 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <Switch
                on={config.showCompleted}
                label="Show completed"
                onClick={() =>
                  onChange({ ...config, showCompleted: !config.showCompleted })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Switch
                on={config.showSubtasks}
                label="Show subtasks"
                onClick={() =>
                  onChange({ ...config, showSubtasks: !config.showSubtasks })
                }
              />
            </div>
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

/**
 * One labelled block of pills.
 *
 * The `role="group"` is functional, not decoration. Pill labels are not
 * unique across the menu — "Status" is both a Group by and a Sort by option,
 * and "Priority" is all three of a group, a sort and a filter — so a query for
 * a button by name alone is ambiguous, and grows *more* ambiguous every time a
 * section is added. Naming the group lets a caller (and a screen reader) say
 * which "Status" it means.
 *
 * `name` overrides the accessible name when the visible label carries a live
 * count ("Filter · 2"), so the group's name stays stable as filters come and go.
 */
function Section({
  label,
  name,
  children,
}: {
  label: string;
  name?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={name ?? label} className="mb-3 last:mb-0">
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
  title,
  onClick,
  children,
}: {
  active: boolean;
  accent?: string;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
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
