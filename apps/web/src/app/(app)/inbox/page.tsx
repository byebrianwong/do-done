import { TaskForm } from "@/components/task-form";
import { TaskItem } from "@/components/task-item";

const MOCK_TASKS = [
  {
    id: "1",
    title: "Review pull request for auth module",
    priority: "p2" as const,
    dueDate: new Date().toISOString().split("T")[0],
    tags: ["work"],
  },
  {
    id: "2",
    title: "Buy groceries for the week",
    priority: "p3" as const,
    dueDate: (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().split("T")[0];
    })(),
    tags: ["personal"],
  },
  {
    id: "3",
    title: "Schedule dentist appointment",
    priority: "p4" as const,
    dueDate: null,
  },
  {
    id: "4",
    title: "Fix critical login bug",
    priority: "p1" as const,
    dueDate: new Date().toISOString().split("T")[0],
    tags: ["work", "urgent"],
  },
];

export default function InboxPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Inbox
      </h1>

      <TaskForm />

      {MOCK_TASKS.length > 0 ? (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {MOCK_TASKS.map((task) => (
            <TaskItem
              key={task.id}
              id={task.id}
              title={task.title}
              priority={task.priority}
              dueDate={task.dueDate}
              tags={task.tags}
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
