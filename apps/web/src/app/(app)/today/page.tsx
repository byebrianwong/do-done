import { addDaysLocalISO } from "@do-done/shared";
import { TodayView } from "@/components/today-view";
import { getDisplayEvents } from "@/lib/calendar-events";
import { read } from "@/lib/read-result";
import { requireServerApis } from "@/lib/supabase/tasks-server";

export default async function TodayPage() {
  const { tasksApi, projectsApi } = await requireServerApis();
  const [allTasks, projects, events] = await Promise.all([
    read(tasksApi.list({ limit: 100, offset: 0 }), "your tasks"),
    read(projectsApi.list(), "your projects"),
    // Not a `read`: calendar events are decoration on a page whose substance
    // is the tasks, and `getDisplayEvents` is best-effort by design — it
    // already returns [] for a disconnected account or a failed Google fetch.
    // Padded a day each side — the server's "today" can differ from the
    // viewer's near midnight; TodayView re-filters to the browser's today.
    getDisplayEvents(addDaysLocalISO(-1), addDaysLocalISO(2)),
  ]);

  return <TodayView allTasks={allTasks} projects={projects} events={events} />;
}
