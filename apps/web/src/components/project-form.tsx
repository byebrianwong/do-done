"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_PROJECT_COLORS } from "@do-done/shared";
import type { Project } from "@do-done/shared";
import { ProjectsApi } from "@do-done/api-client";
import { createClientSupabase } from "@/lib/supabase/client";

interface ProjectFormProps {
  project?: Project; // present = edit mode, absent = create mode
  onClose: () => void;
}

export function ProjectForm({ project, onClose }: ProjectFormProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(
    project?.color ?? DEFAULT_PROJECT_COLORS[0]
  );
  const [icon, setIcon] = useState(project?.icon ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);

    const supabase = createClientSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const projects = new ProjectsApi(supabase, user?.id);

    const result = project
      ? await projects.update(project.id, {
          name: name.trim(),
          color,
          icon: icon || undefined,
        })
      : await projects.create({
          name: name.trim(),
          color,
          icon: icon || undefined,
        });

    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    onClose();
    startTransition(() => router.refresh());
  }

  async function handleDelete() {
    if (!project) return;
    if (
      !confirm(
        `Delete project "${project.name}"? Tasks in it will be unassigned.`
      )
    )
      return;
    const supabase = createClientSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const projects = new ProjectsApi(supabase, user?.id);
    const { error } = await projects.delete(project.id);
    if (error) {
      setError(error.message);
      return;
    }
    onClose();
    startTransition(() => router.push("/projects"));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {project ? "Edit project" : "New project"}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Name
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="Engineering, Personal, …"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-500">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                    color === c
                      ? "border-neutral-900 dark:border-white"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Icon{" "}
              <span className="font-normal text-neutral-400">
                (1-2 chars, e.g. emoji)
              </span>
            </label>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
              placeholder="🚀"
              className="w-20 rounded-md border border-neutral-300 px-3 py-2 text-center text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950">
          {project ? (
            <button
              onClick={handleDelete}
              className="text-xs font-medium text-red-500 hover:text-red-600"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="rounded-md bg-indigo-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
            >
              {saving ? "Saving..." : project ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
