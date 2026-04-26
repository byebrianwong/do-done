"use client";

import { useState } from "react";
import type { Project } from "@do-done/shared";
import { ProjectForm } from "@/components/project-form";

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
