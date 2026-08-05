"use client";

import { useCallback } from "react";
import { copyTaskLink } from "@/lib/task-link";
import { useUndoToast } from "@/components/undo-toast";

/**
 * Copy a task's share link and confirm it on screen. Copying is invisible
 * otherwise — without the toast there's no way to tell it from a misclick, and
 * no way to tell a blocked clipboard from a successful one.
 */
export function useCopyTaskLink(): (taskId: string) => Promise<void> {
  const toast = useUndoToast();
  return useCallback(
    async (taskId: string) => {
      const copied = await copyTaskLink(taskId);
      toast.show({
        message: copied ? "Link copied" : "Couldn’t copy the link",
      });
    },
    [toast]
  );
}
