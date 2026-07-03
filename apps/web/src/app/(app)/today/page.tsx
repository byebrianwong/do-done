import { addDaysLocalISO } from "@do-done/shared";
import { TodayView } from "@/components/today-view";
import { getDisplayEvents } from "@/lib/calendar-events";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";

export default async function TodayPage() {
  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();
  const [{ data: allTasks = [] }, { data: projects = [] }, events] =
    await Promise.all([
      tasksApi
        ? tasksApi.list({ limit: 100, offset: 0 })
        : Promise.resolve({ data: [] }),
      projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
      // Padded a day each side — the server's "today" can differ from the
      // viewer's near midnight; TodayView re-filters to the browser's today.
      getDisplayEvents(addDaysLocalISO(-1), addDaysLocalISO(2)),
    ]);

  return <TodayView allTasks={allTasks} projects={projects} events={events} />;
}
