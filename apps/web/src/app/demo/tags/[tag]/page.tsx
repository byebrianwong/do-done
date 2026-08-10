"use client";

import { use } from "react";
import { decodeTagParam, tasksWithTag } from "@do-done/shared";
import { TagTasksView } from "@/components/tag-tasks-view";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";

export default function DemoTagDetailPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: raw } = use(params);
  const tag = decodeTagParam(raw);
  const { tasks, projects, ready } = useDemoData();
  if (!ready) return <DemoLoading />;

  const tagged = tasksWithTag(tasks, tag).sort(
    (a, b) => a.sort_order - b.sort_order
  );
  return <TagTasksView tag={tag} tasks={tagged} projects={projects} />;
}
