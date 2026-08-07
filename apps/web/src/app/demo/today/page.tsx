"use client";

import { TodayView } from "@/components/today-view";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";

export default function DemoTodayPage() {
  const { tasks, projects, events, ready } = useDemoData();
  if (!ready) return <DemoLoading />;
  return <TodayView allTasks={tasks} projects={projects} events={events} />;
}
