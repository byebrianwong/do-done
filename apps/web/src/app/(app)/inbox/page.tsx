import { TaskForm } from "@/components/task-form";
import { TaskItem } from "@/components/task-item";
import { getServerTasksApi } from "@/lib/supabase/tasks-server";

export default async function InboxPage() {
  const tasksApi = await getServerTasksApi();
  const { data: tasks = [] } = tasksApi
    ? await tasksApi.list({ status: "inbox", limit: 50, offset: 0 })
    : { data: [] };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Inbox
      </h1>

      <TaskForm defaultStatus="inbox" />

      {tasks.length > 0 ? (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              id={task.id}
              title={task.title}
              priority={task.priority}
              dueDate={task.due_date}
              dueTime={task.due_time}
              durationMinutes={task.duration_minutes}
              completed={task.status === "done"}
              tags={task.tags}
              recurrenceRule={task.recurrence_rule}
            />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-400">
            No tasks in your inbox. Add one above to get started.
          </p>
        </div>
      )}
    </div>
  );
}
