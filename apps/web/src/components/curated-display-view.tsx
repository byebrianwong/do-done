"use client";

import { useMemo } from "react";
import {
  filterByConfig,
  type DisplayConfig,
  type Project,
  type Task,
} from "@do-done/shared";
import { useDisplayConfig } from "@/lib/use-display-config";
import { DisplayMenu } from "./display-menu";
import { DraggableTaskGroups } from "./draggable-task-groups-client";

export interface CuratedDisplayViewProps {
  viewKey: string;
  title: string;
  /** The view's task universe (already scoped, e.g. "today's tasks"). */
  allTasks: Task[];
  projects?: Project[];
  /** Rendered under the header (e.g. a quick-add form). */
  beforeContent?: React.ReactNode;
  /** Bespoke default layout, given the filtered task set. */
  renderCurated: (filteredTasks: Task[]) => React.ReactNode;
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

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasks) for (const tag of t.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allTasks]);

  const filtered = useMemo(
    () => filterByConfig(allTasks, config),
    [allTasks, config]
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {title}
        </h1>
        <DisplayMenu
          config={config}
          onChange={setConfig}
          onReset={reset}
          isDefault={isDefault}
          projects={projects}
          availableTags={availableTags}
        />
      </div>

      {beforeContent}

      {curatedWhen(config) ? (
        renderCurated(filtered)
      ) : (
        <DraggableTaskGroups
          tasks={allTasks}
          projects={projects}
          config={config}
          onConfigChange={setConfig}
        />
      )}
    </div>
  );
}
