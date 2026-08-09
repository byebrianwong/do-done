"use client";

/**
 * The project icon field: a preview of the ring the icon will actually appear
 * in, which opens a searchable grid of characters.
 *
 * It replaces a bare text input whose whole affordance was a "🚀" placeholder —
 * on a laptop that meant knowing your OS's emoji shortcut, and there was no way
 * to discover that a symbol like ★ was allowed at all.
 *
 * The catalogue and every rule about what may be stored live in
 * `@do-done/shared` (`project-icons.ts`), because mobile draws the same choice
 * from a different renderer.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PROJECT_ICON_GROUPS,
  searchProjectIcons,
  type ProjectIconOption,
} from "@do-done/shared";

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");
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

  const results = useMemo(() => {
    const searched = searchProjectIcons(query);
    if (group === "all") return searched;
    const inGroup = new Set(
      PROJECT_ICON_GROUPS.find((g) => g.id === group)?.icons.map((i) => i.char)
    );
    return searched.filter((i) => inGroup.has(i.char));
  }, [query, group]);

  // Only headed sections when nothing is narrowing the list; a search result
  // grid split into ten labelled boxes is harder to scan than one grid.
  const sections: { label: string | null; icons: readonly ProjectIconOption[] }[] =
    query.trim() || group !== "all"
      ? [{ label: null, icons: results }]
      : PROJECT_ICON_GROUPS.map((g) => ({ label: g.label, icons: g.icons }));

  const pick = (icon: string) => {
    onChange(icon);
    setOpen(false);
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
              against its real size rather than a big preview that flatters it. */}
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
            style={{ borderColor: color }}
          >
            <span className="text-[9px] leading-none">{value}</span>
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
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const first = results[0];
                  if (first) pick(first.char);
                }
              }}
              placeholder="Search, or paste any character…"
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800 outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
            />
            <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
              {[{ id: "all", label: "All" }, ...PROJECT_ICON_GROUPS].map((g) => (
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

          <div className="max-h-52 overflow-y-auto p-2">
            {results.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-neutral-400">
                Nothing matches “{query.trim()}”. Any character works — paste one
                here.
              </p>
            ) : (
              sections
                .filter((s) => s.icons.length > 0)
                .map((section, i) => (
                  <div key={section.label ?? i} className={i > 0 ? "mt-3" : ""}>
                    {section.label ? (
                      <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                        {section.label}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-0.5">
                      {section.icons.map((icon) => (
                        <button
                          key={icon.char}
                          type="button"
                          title={icon.name}
                          onClick={() => pick(icon.char)}
                          className={`flex h-8 w-8 items-center justify-center rounded-md text-base leading-none transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                            value === icon.char
                              ? "bg-indigo-50 ring-1 ring-indigo-400 dark:bg-indigo-500/20"
                              : ""
                          }`}
                        >
                          <span className="text-neutral-800 dark:text-neutral-100">
                            {icon.char}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
            <span className="text-[10px] text-neutral-400">
              Symbols take the row&apos;s text colour
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
