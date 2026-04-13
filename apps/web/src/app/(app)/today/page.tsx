import { TaskItem } from "@/components/task-item";

const today = new Date().toISOString().split("T")[0];

const FOCUS_TASKS = [
  {
    id: "f1",
    title: "Fix critical login bug",
    priority: "p1" as const,
    dueDate: today,
    tags: ["urgent"],
  },
  {
    id: "f2",
    title: "Review pull request for auth module",
    priority: "p2" as const,
    dueDate: today,
    tags: ["work"],
  },
];

const OTHER_TASKS = [
  {
    id: "t1",
    title: "Update project documentation",
    priority: "p3" as const,
    dueDate: today,
  },
  {
    id: "t2",
    title: "Reply to client email",
    priority: "p3" as const,
    dueDate: today,
    tags: ["work"],
  },
  {
    id: "t3",
    title: "Pick up dry cleaning",
    priority: "p4" as const,
    dueDate: today,
    tags: ["personal"],
  },
];

export default function TodayPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Today
      </h1>

      {/* Focus section */}
      <section className="mb-8">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            Focus
          </h2>
          <div className="space-y-0.5">
            {FOCUS_TASKS.map((task) => (
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
        </div>
      </section>

      {/* Remaining tasks */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Other tasks
        </h2>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {OTHER_TASKS.map((task) => (
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
      </section>
    </div>
  );
}
