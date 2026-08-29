import { AllTasksView } from "@/components/all-tasks-view";
import { read } from "@/lib/read-result";
import { requireServerApis } from "@/lib/supabase/tasks-server";

export default async function AllTasksPage() {
  const { tasksApi, projectsApi } = await requireServerApis();
  const [tasks, projects] = await Promise.all([
    read(tasksApi.list({ limit: 500, offset: 0 }), "your tasks"),
    read(projectsApi.list(), "your projects"),
  ]);

  return <AllTasksView tasks={tasks} projects={projects} />;
}
