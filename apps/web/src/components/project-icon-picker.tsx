"use client";

/**
 * The project icon field: a preview of the ring the icon will actually appear
 * in, which opens a searchable grid.
 *
 * Two tabs, because `projects.icon` holds two kinds of thing. **Icons** is the
 * curated Phosphor set, drawn in one of three weights and tinted to the
 * project's colour. **Emoji** is the original character grid, which stays
 * because the drawn set has no long tail — nobody's cat is in Phosphor.
 *
 * The catalogue, the token format and every rule about what may be stored live
 * in `@do-done/shared`, because mobile and the home-screen widget draw the same
 * choice through different renderers.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PHOSPHOR_CATALOGUE,
  PHOSPHOR_WEIGHTS,
  PROJECT_ICON_GROUPS,
  formatPhosphorIcon,
  parseProjectIcon,
  searchPhosphorIcons,
  searchProjectIcons,
  type PhosphorWeight,
  type ProjectIconOption,
} from "@do-done/shared";
import { ProjectIcon } from "@/components/project-icon";

type Tab = "icons" | "emoji";

interface ProjectIconPickerProps {
  value: string;
  onChange: (icon: string) => void;
  /** The project's colour — the preview is the row's ring, not a swatch. */
  color: string;
}

export function ProjectIconPicker({
  value,
  onChange,
  color,
}: ProjectIconPickerProps) {
  const parsed = parseProjectIcon(value);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(
    parsed.kind === "emoji" ? "emoji" : "icons"
  );
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");
  // The weight outlives the icon on purpose: switching from Briefcase to House
  // keeps the treatment you already chose, and picking a second project's icon
  // starts on the one you used last.
  const [weight, setWeight] = useState<PhosphorWeight>(
    parsed.kind === "phosphor" ? parsed.weight : "fill"
  );
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Escape closes the grid before it closes the dialog — one Escape per layer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else {
      setQuery("");
      setGroup("all");
    }
  }, [open]);

  // Changing group filter is per-tab; a "Shapes" chip means nothing on the
  // emoji tab, so switching tabs clears it rather than filtering to nothing.
  const switchTab = (next: Tab) => {
    setTab(next);
    setGroup("all");
    searchRef.current?.focus();
  };

  const emojiResults = useMemo(() => {
    const searched = searchProjectIcons(query);
    if (group === "all") return searched;
    const inGroup = new Set(
      PROJECT_ICON_GROUPS.find((g) => g.id === group)?.icons.map((i) => i.char)
    );
    return searched.filter((i) => inGroup.has(i.char));
  }, [query, group]);

  const iconResults = useMemo(() => {
    const searched = searchPhosphorIcons(query);
    return group === "all"
      ? searched
      : searched.filter((i) => i.groupId === group);
  }, [query, group]);

  const narrowed = query.trim() !== "" || group !== "all";
  const groups = tab === "emoji" ? PROJECT_ICON_GROUPS : PHOSPHOR_CATALOGUE;

  // Headed sections only when nothing is narrowing the list; a filtered result
  // set broken into eleven labelled boxes is harder to scan than one grid.
  const emojiSections: {
    label: string | null;
    icons: readonly ProjectIconOption[];
  }[] = narrowed
    ? [{ label: null, icons: emojiResults }]
    : PROJECT_ICON_GROUPS.map((g) => ({ label: g.label, icons: g.icons }));

  const iconSections = narrowed
    ? [{ label: null, icons: iconResults }]
    : PHOSPHOR_CATALOGUE.map((g) => ({
        label: g.label,
        icons: g.icons.map((i) => ({ ...i, groupId: g.id })),
      }));

  const empty = (tab === "emoji" ? emojiResults : iconResults).length === 0;

  const pick = (icon: string) => {
    onChange(icon);
    setOpen(false);
  };

  const pickWeight = (next: PhosphorWeight) => {
    setWeight(next);
    // Re-stamp the current pick so the ring updates as the weight is chosen,
    // rather than the choice only applying to whatever is picked next.
    if (parsed.kind === "phosphor") {
      onChange(formatPhosphorIcon(parsed.name, next));
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex h-9 items-center gap-2 rounded-md border border-neutral-300 px-2 pr-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {/* The same 20 px ring the task rows draw, so the choice is made
              against its real size rather than a big preview that flatters it.
              A drawn icon takes the project's colour; an emoji brings its own. */}
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
            style={{ borderColor: color, color }}
          >
            <ProjectIcon icon={value} size={11} />
          </span>
          <span className="text-xs text-neutral-600 dark:text-neutral-300">
            {value ? "Change" : "Choose an icon"}
          </span>
        </button>

        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs font-medium text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-200"
          >
            Remove
          </button>
        ) : null}
      </div>

      {/* The grid opens in flow, not floating: the dialog around it is
          `overflow-hidden` (that's what rounds its header and footer), so an
          absolutely positioned panel is clipped the moment it passes the
          footer. The form grows instead — same as the mobile sheet. */}
      {open ? (
        <div
          role="group"
          aria-label="Choose an icon"
          className="mt-2 rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="border-b border-neutral-100 p-2 dark:border-neutral-800">
            <div
              role="tablist"
              aria-label="Icon kind"
              className="mb-2 flex gap-1"
            >
              {([
                ["icons", "Icons"],
                ["emoji", "Emoji"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => switchTab(id)}
                  className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    tab === id
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (tab === "emoji") {
                  const first = emojiResults[0];
                  if (first) pick(first.char);
                } else {
                  const first = iconResults[0];
                  if (first) pick(formatPhosphorIcon(first.name, weight));
                }
              }}
              placeholder={
                tab === "emoji"
                  ? "Search, or paste any character…"
                  : "Search icons…"
              }
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800 outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
            />

            {tab === "icons" ? (
              <div className="mt-2 flex items-center gap-1">
                <span className="mr-1 text-[10px] uppercase tracking-wide text-neutral-400">
                  Style
                </span>
                {PHOSPHOR_WEIGHTS.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    title={w.hint}
                    onClick={() => pickWeight(w.id)}
                    aria-pressed={weight === w.id}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      weight === w.id
                        ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-400 dark:bg-indigo-500/20 dark:text-indigo-200"
                        : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {/* The label is shown *in* the weight it names — the fastest
                        way to say what "Light fill" means is to draw it. */}
                    <ProjectIcon
                      icon={formatPhosphorIcon("circle", w.id)}
                      size={13}
                    />
                    {w.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
              {[{ id: "all", label: "All" }, ...groups].map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroup(g.id)}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    group === g.id
                      ? "bg-indigo-500 text-white"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-52 dd-scroll overflow-y-auto p-2">
            {empty ? (
              <p className="px-1 py-6 text-center text-xs text-neutral-400">
                {tab === "emoji" ? (
                  <>
                    Nothing matches “{query.trim()}”. Any character works — paste
                    one here.
                  </>
                ) : (
                  <>
                    No icon matches “{query.trim()}”. The Emoji tab has the long
                    tail.
                  </>
                )}
              </p>
            ) : tab === "emoji" ? (
              emojiSections
                .filter((s) => s.icons.length > 0)
                .map((section, i) => (
                  <div key={section.label ?? i} className={i > 0 ? "mt-3" : ""}>
                    {section.label ? <SectionLabel>{section.label}</SectionLabel> : null}
                    <div className="flex flex-wrap gap-0.5">
                      {section.icons.map((icon) => (
                        <button
                          key={icon.char}
                          type="button"
                          title={icon.name}
                          onClick={() => pick(icon.char)}
                          className={cellClass(value === icon.char)}
                        >
                          <span className="text-base leading-none text-neutral-800 dark:text-neutral-100">
                            {icon.char}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
            ) : (
              iconSections
                .filter((s) => s.icons.length > 0)
                .map((section, i) => (
                  <div key={section.label ?? i} className={i > 0 ? "mt-3" : ""}>
                    {section.label ? <SectionLabel>{section.label}</SectionLabel> : null}
                    <div className="flex flex-wrap gap-0.5">
                      {section.icons.map((icon) => {
                        const token = formatPhosphorIcon(icon.name, weight);
                        return (
                          <button
                            key={`${section.label ?? "r"}-${icon.name}`}
                            type="button"
                            title={icon.label}
                            onClick={() => pick(token)}
                            className={cellClass(value === token)}
                            // Drawn icons preview in the project's own colour,
                            // which is how they will actually appear.
                            style={{ color }}
                          >
                            <ProjectIcon icon={token} size={20} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
            <span className="text-[10px] text-neutral-400">
              {tab === "icons"
                ? "Icons take the project's colour"
                : "Symbols take the row's text colour"}
            </span>
            <button
              type="button"
              onClick={() => pick("")}
              className="rounded px-2 py-1 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              No icon
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
      {children}
    </div>
  );
}

function cellClass(selected: boolean) {
  return `flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
    selected ? "bg-indigo-50 ring-1 ring-indigo-400 dark:bg-indigo-500/20" : ""
  }`;
}
