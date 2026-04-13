import { TaskItem } from "@/components/task-item";

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function formatDayHeading(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) return "Today";
  if (date.getTime() === tomorrow.getTime()) return "Tomorrow";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

const UPCOMING_GROUPS = [
  {
    date: addDays(0),
    tasks: [
      {
        id: "u1",
        title: "Fix critical login bug",
        priority: "p1" as const,
        tags: ["urgent"],
      },
      {
        id: "u2",
        title: "Review pull request for auth module",
        priority: "p2" as const,
        tags: ["work"],
      },
    ],
  },
  {
    date: addDays(1),
    tasks: [
      {
        id: "u3",
        title: "Buy groceries for the week",
        priority: "p3" as const,
        tags: ["personal"],
      },
      {
        id: "u4",
        title: "Team standup meeting",
        priority: "p3" as const,
        tags: ["work"],
      },
    ],
  },
  {
    date: addDays(2),
    tasks: [
      {
        id: "u5",
        title: "Write blog post draft",
        priority: "p3" as const,
        tags: [],
      },
    ],
  },
  {
    date: addDays(3),
    tasks: [
      {
        id: "u6",
        title: "Dentist appointment",
        priority: "p2" as const,
        tags: ["personal"],
      },
    ],
  },
  {
    date: addDays(5),
    tasks: [
      {
        id: "u7",
        title: "Submit quarterly report",
        priority: "p2" as const,
        tags: ["work"],
      },
      {
        id: "u8",
        title: "Plan weekend trip",
        priority: "p4" as const,
        tags: ["personal"],
      },
    ],
  },
];

export default function UpcomingPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Upcoming
      </h1>

      <div className="space-y-6">
        {UPCOMING_GROUPS.map((group) => (
          <section key={group.date}>
            <h2 className="mb-2 border-b border-neutral-100 pb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:border-neutral-800">
              {formatDayHeading(group.date)}
            </h2>
            <div className="space-y-0.5">
              {group.tasks.map((task) => (
                <TaskItem
                  key={task.id}
                  id={task.id}
                  title={task.title}
                  priority={task.priority}
                  dueDate={group.date}
                  tags={task.tags}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
