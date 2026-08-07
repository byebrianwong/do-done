"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { addDaysLocalISO, todayLocalISO } from "@do-done/shared";
import type { Task } from "@do-done/shared";
import { UpcomingView } from "@/components/upcoming-view";
import { InboxFilterToggle } from "@/components/inbox-filter-toggle";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";

const HORIZON_DAYS = 30;
const CLOSED = new Set(["done", "cancelled", "archived"]);

/**
 * The sandbox's Upcoming. The real page unions three server queries — dated
 * within the horizon, undated, and overdue — so this filters the same three
 * sets out of the store rather than inventing a different rule for the demo.
 */
export default function DemoUpcomingPage() {
  const { tasks, projects, events, ready } = useDemoData();
  if (!ready) return <DemoLoading />;

  const today = todayLocalISO();
  const horizon = addDaysLocalISO(HORIZON_DAYS);
  const open = tasks.filter((t) => !CLOSED.has(t.status));

  const belongs = (t: Task) => {
    const dates = [t.scheduled_date, t.deadline_date].filter(Boolean) as string[];
    if (dates.length === 0) return true; // undated — draggable onto a real day
    return dates.some((d) => d < today || d <= horizon);
  };

  const universe = open.filter(belongs);
  const inboxCount = universe.filter((t) => t.status === "inbox").length;

  return (
    <Suspense fallback={<DemoLoading />}>
      <UpcomingContent
        universe={universe}
        inboxCount={inboxCount}
        projects={projects}
        events={events}
      />
    </Suspense>
  );
}

/**
 * Split out because `InboxFilterToggle` reads the query string, and a
 * `useSearchParams()` anywhere in a prerendered tree needs a Suspense boundary
 * above it or the whole route fails to build.
 */
function UpcomingContent({
  universe,
  inboxCount,
  projects,
  events,
}: {
  universe: Task[];
  inboxCount: number;
  projects: React.ComponentProps<typeof UpcomingView>["projects"];
  events: React.ComponentProps<typeof UpcomingView>["events"];
}) {
  const hideInbox = useSearchParams().get("inbox") === "hide";

  return (
    <UpcomingView
      allTasks={hideInbox ? universe.filter((t) => t.status !== "inbox") : universe}
      projects={projects}
      events={events}
      beforeContent={
        <div className="mb-4">
          <InboxFilterToggle count={inboxCount} />
        </div>
      }
    />
  );
}
