"use client";

import { useCallback } from "react";
import { OpenTaskProvider, useOpenTask } from "@/lib/open-task";
import { useQuickAddContext } from "@/lib/quick-add-context";
import { useUndoToast } from "./undo-toast";
import { TaskEditModalV2 } from "./task-edit-modal-v2";

/**
 * Mounts the app-wide task editor: one modal, addressable by URL.
 *
 * Both halves live here rather than in the row that was clicked, so the editor
 * can also be opened by a link (`?task=<id>`) with no row on screen at all.
 */
export function TaskEditorProvider({ children }: { children: React.ReactNode }) {
  const toast = useUndoToast();
  const onMissing = useCallback(
    () => toast.show({ message: "That task no longer exists." }),
    [toast]
  );

  return (
    <OpenTaskProvider onMissing={onMissing}>
      {children}
      <OpenTaskModal />
    </OpenTaskProvider>
  );
}

function OpenTaskModal() {
  const openTask = useOpenTask();
  // Includes projects created inline elsewhere this session, so the editor's
  // Project field can offer them before a refresh lands.
  const { projects } = useQuickAddContext();
  if (!openTask?.task) return null;
  return (
    <TaskEditModalV2
      task={openTask.task}
      projects={projects}
      open
      onClose={openTask.close}
    />
  );
}
