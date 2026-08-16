"use client";

import { useState } from "react";
import type { Project } from "@do-done/shared";
import { ProjectForm } from "@/components/project-form";

/**
 * The Edit button on a project's or a list's own page.
 *
 * A shopping list is a project with a different `kind`, so the same button
 * opens the same form — which already says "Edit list" and warns about the
 * right thing when deleting. It sits in `components/` rather than under the
 * projects route because both pages render it.
 */
export function ProjectActions({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <button
        onClick={() => setEditing(true)}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        Edit
      </button>
      {editing && (
        <ProjectForm project={project} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
