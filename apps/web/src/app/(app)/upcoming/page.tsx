import { UpcomingView } from "@/components/upcoming-view";
import { InboxFilterToggle } from "@/components/inbox-filter-toggle";
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
    { data: projects = [] },
  ] = await Promise.all([
    tasksApi ? tasksApi.getUpcoming(30) : Promise.resolve({ data: [] }),
    tasksApi ? tasksApi.listUndated() : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
  ]);

  // Inbox task count is computed pre-filter so the toggle pill can show
  // "how many would reappear if I un-hide them".
  const all = [...rawTasks, ...rawUndated];
  const inboxCount = all.filter((t) => t.status === "inbox").length;
  const universe = hideInbox
    ? all.filter((t) => t.status !== "inbox")
    : all;

  return (
    <UpcomingView
      allTasks={universe}
      projects={projects}
      beforeContent={
        <div className="mb-4">
          <InboxFilterToggle count={inboxCount} />
        </div>
      }
    />
  );
}
