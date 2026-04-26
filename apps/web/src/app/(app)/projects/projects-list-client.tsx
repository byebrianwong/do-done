"use client";

import { useState, useEffect } from "react";
import { ProjectForm } from "@/components/project-form";

const NEW_PROJECT_EVENT = "do-done:open-new-project";

export function NewProjectButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(NEW_PROJECT_EVENT))}
      className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600"
    >
      + New project
    </button>
  );
}

export function NewProjectMount() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(NEW_PROJECT_EVENT, handler);
    return () => window.removeEventListener(NEW_PROJECT_EVENT, handler);
  }, []);

  if (!open) return null;
  return <ProjectForm onClose={() => setOpen(false)} />;
}
