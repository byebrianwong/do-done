import { addDaysLocalISO, type Task } from "@do-done/shared";
import { UpcomingView } from "@/components/upcoming-view";
import { InboxFilterToggle } from "@/components/inbox-filter-toggle";
import { getDisplayEvents } from "@/lib/calendar-events";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";

export default async function UpcomingPage({
  searchParams,
}: {
  searchParams: Promise<{ inbox?: string }>;
}) {
  const params = await searchParams;
  const hideInbox = params.inbox === "hide";

  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();
  const [
    { data: rawTasks = [] },
    { data: rawUndated = [] },
    { data: rawOverdue = [] },
    { data: projects = [] },
    events,
  ] = await Promise.all([
    tasksApi ? tasksApi.getUpcoming(30) : Promise.resolve({ data: [] }),
    tasksApi ? tasksApi.listUndated() : Promise.resolve({ data: [] }),
    tasksApi ? tasksApi.listOverdue() : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
    // Same horizon as getUpcoming, padded a day each side: the server's
    // "today" can differ from the viewer's near midnight, and the per-day
    // grouping drops anything outside the visible columns anyway.
    getDisplayEvents(addDaysLocalISO(-1), addDaysLocalISO(32)),
  ]);

  // getUpcoming's today−1 skew buffer overlaps listOverdue on yesterday's rows,
  // so dedupe by id when combining the three task sources. UpcomingView buckets
  // the overdue ones into their own section.
  const byId = new Map<string, Task>();
  for (const t of [...rawTasks, ...rawUndated, ...rawOverdue]) byId.set(t.id, t);
  const all = [...byId.values()];

  // Inbox task count is computed pre-filter so the toggle pill can show
  // "how many would reappear if I un-hide them".
  const inboxCount = all.filter((t) => t.status === "inbox").length;
  const universe = hideInbox
    ? all.filter((t) => t.status !== "inbox")
    : all;

  return (
    <UpcomingView
      allTasks={universe}
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
