"use client";

import { compareTaskOrder } from "@do-done/shared";
import { AllTasksView } from "@/components/all-tasks-view";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";

export default function DemoAllTasksPage() {
  const { tasks, projects, ready } = useDemoData();
  if (!ready) return <DemoLoading rows={10} />;

  const ordered = [...tasks].sort(compareTaskOrder);
  return <AllTasksView tasks={ordered} projects={projects} />;
}
