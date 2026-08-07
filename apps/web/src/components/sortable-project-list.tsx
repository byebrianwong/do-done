"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Project } from "@do-done/shared";
import { getClientProjectsApi } from "@/lib/supabase/projects-client";
import { DEMO_BASE, isDemoPath } from "@/lib/demo/mode";

export interface SortableProjectListProps {
  projects: Project[];
}

function rowClassName(isActive: boolean): string {
  return `group/prow flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors ${
    isActive
      ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
  }`;
}

function ProjectRowContent({ project }: { project: Project }) {
  return (
    <>
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: project.color }}
      />
      <span className="truncate">
        {project.icon ? `${project.icon} ` : ""}
        {project.name}
      </span>
      {/* Drag affordance — reveals on hover; the whole row is the handle. */}
      <span
        aria-hidden
        className="ml-auto text-neutral-300 opacity-0 transition-opacity group-hover/prow:opacity-100 dark:text-neutral-600"
      >
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="7" cy="6" r="1.5" />
          <circle cx="13" cy="6" r="1.5" />
          <circle cx="7" cy="10" r="1.5" />
          <circle cx="13" cy="10" r="1.5" />
          <circle cx="7" cy="14" r="1.5" />
          <circle cx="13" cy="14" r="1.5" />
        </svg>
      </span>
    </>
  );
}

// Non-draggable row rendered on the server and on the first client paint, so
// the sidebar shows projects immediately with no hydration mismatch. Drag turns
// on once mounted (see below).
function StaticProjectRow({
  project,
  href,
  isActive,
}: {
  project: Project;
  href: string;
  isActive: boolean;
}) {
  return (
    <Link href={href} className={rowClassName(isActive)}>
      <ProjectRowContent project={project} />
    </Link>
  );
}

function SortableProjectRow({
  project,
  href,
  isActive,
}: {
  project: Project;
  href: string;
  isActive: boolean;
}) {
  // Only `listeners` (pointer activators) and `setNodeRef` are spread — not
  // `attributes`, whose default `role="button"` would strip the anchor's native
  // link role. We register no keyboard sensor, so those a11y attributes add
  // nothing here.
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: project.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 1 : undefined,
  };

  // A plain click still navigates (the MouseSensor only starts a drag after 4px
  // of movement); `draggable={false}` suppresses the browser's native link drag.
  return (
    <Link
      ref={setNodeRef}
      href={href}
      draggable={false}
      style={style}
      suppressHydrationWarning
      className={`${rowClassName(isActive)} touch-manipulation`}
      {...listeners}
    >
      <ProjectRowContent project={project} />
    </Link>
  );
}

export function SortableProjectList({ projects }: SortableProjectListProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [items, setItems] = useState(projects);
  const [mounted, setMounted] = useState(false);

  // Mouse: drag after a 4px move (so a click navigates). Touch: drag only after
  // a short press, so a vertical swipe scrolls instead of reordering. Mirrors
  // the task list's sensor config.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    })
  );

  useEffect(() => setMounted(true), []);

  // Resync local order whenever the server returns a different set of ids.
  const idsKey = projects.map((p) => p.id).join(",");
  useEffect(() => {
    setItems(projects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Demo routes mirror the app one level down, so project links have to stay
  // inside `/demo` too. See `SidebarNav`.
  const base = isDemoPath(pathname) ? DEMO_BASE : "";
  const hrefFor = (p: Project) => `${base}/projects/${p.id}`;
  const isActive = (p: Project) => pathname === hrefFor(p);

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((p) => p.id === active.id);
    const newIndex = items.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const previous = items;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next); // optimistic

    const api = await getClientProjectsApi();
    const { error } = await api.reorder(next.map((p) => p.id));
    if (error) {
      console.error("Project reorder failed:", error);
      setItems(previous); // rollback
      return;
    }
    startTransition(() => router.refresh());
  }

  if (!mounted) {
    return (
      <div className="space-y-0.5">
        {items.map((p) => (
          <StaticProjectRow
            key={p.id}
            project={p}
            href={hrefFor(p)}
            isActive={isActive(p)}
          />
        ))}
      </div>
    );
  }

  return (
    <DndContext
      id="sortable-project-list-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((p) => p.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-0.5">
          {items.map((p) => (
            <SortableProjectRow
              key={p.id}
              project={p}
              href={hrefFor(p)}
              isActive={isActive(p)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
