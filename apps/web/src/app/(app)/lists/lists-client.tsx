"use client";

import { useState, useEffect } from "react";
import { ProjectForm } from "@/components/project-form";

/**
 * The button and the dialog are separate exports for the same reason the
 * projects index does it: the page is a server component, so it can render the
 * trigger in the header and mount the dialog at the bottom without either one
 * turning the whole page into a client tree.
 */
const NEW_LIST_EVENT = "do-done:open-new-list";

export function NewListButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(NEW_LIST_EVENT))}
      className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 active:bg-indigo-700"
    >
      + New list
    </button>
  );
}

export function NewListMount() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(NEW_LIST_EVENT, handler);
    return () => window.removeEventListener(NEW_LIST_EVENT, handler);
  }, []);

  if (!open) return null;
  return <ProjectForm kind="list" onClose={() => setOpen(false)} />;
}
