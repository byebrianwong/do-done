"use client";

import { useMemo } from "react";
import {
  filterByConfig,
  sortTasks,
  type DisplayConfig,
  type Project,
  type Task,
} from "@do-done/shared";
import { useDisplayConfig } from "@/lib/use-display-config";
import { TaskRowBehaviorProvider } from "@/lib/task-row-behavior";
import { useTasksHeldForEditing } from "@/lib/task-editing-hold";
import { DisplayMenu } from "./display-menu";
import { DraggableTaskGroups } from "./draggable-task-groups-client";
import { StickyPageBar } from "./sticky-page-bar";

export interface CuratedDisplayViewProps {
  viewKey: string;
  title: string;
  /** The view's task universe (already scoped, e.g. "today's tasks"). */
  allTasks: Task[];
  projects?: Project[];
  /** Rendered under the header (e.g. a quick-add form). */
  beforeContent?: React.ReactNode;
  /** Bespoke default layout, given the filtered task set + the live config and
   *  its setter (so curated sections can persist collapse state). */
  renderCurated: (
    filteredTasks: Task[],
    config: DisplayConfig,
    onConfigChange: (next: DisplayConfig) => void
  ) => React.ReactNode;
  /**
   * Show the curated layout for this config (typically: the view's default
   * grouping + manual sort). Filters still apply *within* the curated layout;
   * changing group/sort flips to the generic grouped list.
   */
  curatedWhen: (config: DisplayConfig) => boolean;
}

/**
 * View shell for screens with a hand-designed default layout (Today's focus
 * sections, Upcoming's day columns). Keeps that layout as the default but adds
 * the Display menu: filters refine the curated layout in place, while changing
 * group/sort switches to the generic grouped list.
 */
export function CuratedDisplayView({
  viewKey,
  title,
  allTasks,
  projects,
  beforeContent,
  renderCurated,
  curatedWhen,
}: CuratedDisplayViewProps) {
  const { config, setConfig, reset, isDefault } = useDisplayConfig(viewKey);

  // A task whose editor is open holds its row, even once a save has scheduled
  // it out of this view's universe — the modal is rendered by the row.
  const universe = useTasksHeldForEditing(allTasks);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of universe) for (const tag of t.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [universe]);

  // Sorted as well as filtered. A curated layout is only ever shown under
  // manual sort (that's what `curatedWhen` asks for on both views), so this is
  // `sort_order` — the one field carrying the order the user dragged rows
  // into. Nothing else applied it: the generic branch sorts inside
  // `applyDisplay`, but the curated branch handed these rows straight to the
  // day columns in whatever order the query returned them, and `getUpcoming`
  // orders by scheduled_date / deadline_date / priority with no mention of
  // sort_order. So a drop wrote a new order and the refresh read the old one
  // back — the row appeared where it was dropped, then slid to wherever
  // priority put it a moment later.
  const filtered = useMemo(
    () => sortTasks(filterByConfig(universe, config), config.sort),
    [universe, config]
  );

  return (
    <div className="mx-auto max-w-3xl">
      <StickyPageBar
        title={title}
        actions={
          <DisplayMenu
            config={config}
            onChange={setConfig}
            onReset={reset}
            isDefault={isDefault}
            projects={projects}
            availableTags={availableTags}
          />
        }
      >

      {beforeContent}

      {/* With "show completed" on, a ticked-off task stays in the list — so its
          row must not play the collapse-and-vanish exit it would elsewhere. */}
      <TaskRowBehaviorProvider
        keepsCompleted={config.showCompleted}
        density={config.density}
        rowStyle={config.rowStyle}
      >
        {curatedWhen(config) ? (
          renderCurated(filtered, config, setConfig)
        ) : (
          <DraggableTaskGroups
            tasks={universe}
            projects={projects}
            config={config}
            onConfigChange={setConfig}
          />
        )}
      </TaskRowBehaviorProvider>
      </StickyPageBar>
    </div>
  );
}
