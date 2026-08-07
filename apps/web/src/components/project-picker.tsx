"use client";

/**
 * Shared project picker popover — used by the task row's inline project chip
 * and the task edit modal's Project field. Lists existing projects, offers a
 * "No project" clear option, and an inline "+ New project" create flow that
 * provisions the project and selects it in one step.
 *
 * Presentational + self-contained: the popover positions itself absolutely
 * under its trigger (host wraps it in a relatively-positioned container and
 * handles click-outside via useClickOutside). Escape closes it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PROJECT_COLORS } from "@do-done/shared";
import type { Project } from "@do-done/shared";
import { getProjectsApiFor } from "@/lib/supabase/projects-client";

export function ProjectPickerPopover({
  projects,
  selectedId,
  userId,
  onSelect,
  onCreated,
  onClose,
  align = "left",
}: {
  projects: Project[];
  selectedId: string | null;
  /** Owner of the new project — the task's user_id. */
  userId: string;
  onSelect: (projectId: string | null) => void;
  /** Fired after a new project is created so the host can merge it locally. */
  onCreated: (project: Project) => void;
  onClose: () => void;
  align?: "left" | "right";
}) {
  const projectsApi = useMemo(
    () => getProjectsApiFor(userId),
    [userId]
  );

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

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

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    const { data, error: createError } = await projectsApi.create({
      name: trimmed,
      color,
    });
    setSaving(false);
    if (createError || !data) {
      setError(createError?.message ?? "Could not create project");
      return;
    }
    onCreated(data);
    onSelect(data.id);
    onClose();
  };

  return (
    <div
      role="listbox"
      aria-label="Project options"
      className={`absolute top-full z-30 mt-2 max-h-[280px] w-[220px] overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-[0_12px_24px_rgba(17,24,39,0.10),0_2px_6px_rgba(17,24,39,0.05)] dark:border-neutral-800 dark:bg-neutral-950 ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {/* No project / clear */}
      <button
        type="button"
        role="option"
        aria-selected={selectedId === null}
        onClick={() => {
          onSelect(null);
          onClose();
        }}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900 ${
          selectedId === null ? "bg-indigo-50/60 dark:bg-indigo-950/40" : ""
        }`}
      >
        <span
          className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-neutral-400"
          aria-hidden
        />
        <span className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">
          No project
        </span>
        {selectedId === null ? (
          <span className="ml-auto text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
            ✓
          </span>
        ) : null}
      </button>

      {projects.map((p) => {
        const selected = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => {
              onSelect(p.id);
              onClose();
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900 ${
              selected ? "bg-indigo-50/60 dark:bg-indigo-950/40" : ""
            }`}
          >
            <span
              className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: p.color }}
              aria-hidden
            />
            <span className="truncate text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
              {p.icon ? `${p.icon} ` : ""}
              {p.name}
            </span>
            {selected ? (
              <span className="ml-auto text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                ✓
              </span>
            ) : null}
          </button>
        );
      })}

      {/* Inline create */}
      <div className="border-t border-neutral-100 dark:border-neutral-900">
        {creating ? (
          <div className="px-3 py-2.5">
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setCreating(false);
                  setName("");
                }
              }}
              maxLength={100}
              placeholder="Project name…"
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-[13px] text-neutral-800 outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {DEFAULT_PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${
                    color === c
                      ? "border-neutral-900 dark:border-white"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            {error ? (
              <div className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
                {error}
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setName("");
                  setError(null);
                }}
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!name.trim() || saving}
                className="rounded-md bg-indigo-500 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-indigo-600 dark:hover:bg-neutral-900 dark:hover:text-indigo-400"
          >
            <span
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-dashed border-neutral-300 text-[11px] leading-none dark:border-neutral-700"
              aria-hidden
            >
              +
            </span>
            New project
          </button>
        )}
      </div>
    </div>
  );
}
