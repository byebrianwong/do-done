"use client";

import {
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from "@dnd-kit/core";
import type { Project, Task } from "@do-done/shared";
import { TaskItem } from "./task-item";

// Keep the in-list placeholder faded while the lifted clone animates back into
// place on drop, so there's never a frame where both the row and the overlay
// read at full strength.
const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.4" } },
  }),
};

/**
 * The "lifted" clone that tracks the cursor during a drag. dnd-kit renders it
 * in a portal and sizes it to the row being dragged, so it sits over the list
 * 1:1 — just elevated (shadow + ring) and slightly translucent so it clearly
 * reads as picked-up. Pass the task currently under the cursor (or null when
 * nothing is being dragged).
 *
 * Mirrors the `SortableRow` layout (grip + TaskItem) so the floating copy looks
 * identical to the source row.
 */
export function TaskDragOverlay({
  task,
  projects,
}: {
  task: Task | null;
  projects?: Project[];
}) {
  return (
    <DragOverlay dropAnimation={dropAnimation}>
      {task ? (
        <div className="flex cursor-grabbing items-stretch rounded-lg bg-white opacity-90 shadow-xl shadow-black/10 ring-1 ring-black/5 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/10">
          <div
            aria-hidden
            className="flex w-5 items-center justify-center text-neutral-400 dark:text-neutral-500"
          >
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="7" cy="5" r="1.5" />
              <circle cx="13" cy="5" r="1.5" />
              <circle cx="7" cy="10" r="1.5" />
              <circle cx="13" cy="10" r="1.5" />
              <circle cx="7" cy="15" r="1.5" />
              <circle cx="13" cy="15" r="1.5" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <TaskItem task={task} projects={projects} />
          </div>
        </div>
      ) : null}
    </DragOverlay>
  );
}
