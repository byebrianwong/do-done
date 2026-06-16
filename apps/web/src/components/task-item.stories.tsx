import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TaskItem } from "./task-item";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

const meta: Meta<typeof TaskItem> = {
  title: "Components/TaskItem",
  component: TaskItem,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl bg-white p-4 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const today = new Date().toISOString().split("T")[0];
const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
})();
const yesterday = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
})();
const nextWeek = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  return d.toISOString().split("T")[0];
})();

export const Default: Story = {
  args: { task: makeTask({ title: "Review pull request", priority: "p3" }) },
};

export const HighPriority: Story = {
  args: {
    task: makeTask({
      title: "Fix critical login bug",
      priority: "p1",
      tags: ["urgent", "work"],
    }),
  },
};

export const Overdue: Story = {
  args: {
    task: makeTask({
      title: "Submit quarterly report",
      priority: "p2",
      due_date: yesterday,
    }),
  },
};

export const DueToday: Story = {
  args: {
    task: makeTask({
      title: "Team standup",
      priority: "p2",
      due_date: today,
      due_time: "09:30",
      duration_minutes: 30,
    }),
  },
};

export const Recurring: Story = {
  args: {
    task: makeTask({
      title: "Weekly retro",
      priority: "p3",
      due_date: today,
      due_time: "16:00",
      duration_minutes: 60,
      recurrence_rule: "FREQ=WEEKLY;BYDAY=FR",
    }),
  },
};

export const Weekdays: Story = {
  args: {
    task: makeTask({
      title: "Daily standup",
      priority: "p2",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    }),
  },
};

export const Completed: Story = {
  args: {
    task: makeTask({
      title: "Deploy v2 release",
      priority: "p1",
      status: "done",
    }),
  },
};

export const ScheduleableTask: Story = {
  name: "Has duration but no time (shows Schedule button on hover)",
  args: {
    task: makeTask({
      title: "Deep work session",
      priority: "p2",
      duration_minutes: 90,
    }),
  },
};

export const ScheduledWithTime: Story = {
  name: "When date + time (do date with time of day)",
  args: {
    task: makeTask({
      title: "Deep work session",
      priority: "p2",
      when_date: tomorrow,
      when_time: "15:00",
      duration_minutes: 90,
    }),
  },
};

export const Future: Story = {
  args: {
    task: makeTask({
      title: "Plan weekend trip",
      priority: "p4",
      due_date: nextWeek,
      tags: ["personal"],
    }),
  },
};

export const WithProject: Story = {
  args: {
    task: makeTask({
      title: "Refactor auth module",
      priority: "p2",
      project_id: "proj-1",
    }),
    projects: SAMPLE_PROJECTS,
  },
};

// ── Status edge cases ──────────────────────────────────────────────────

export const InboxStatus: Story = {
  name: "Inbox (no status badge)",
  args: { task: makeTask({ title: "Capture a fleeting idea", status: "inbox" }) },
};

export const InProgress: Story = {
  args: {
    task: makeTask({
      title: "Migrate the legacy importer",
      priority: "p2",
      status: "in_progress",
      project_id: "proj-1",
    }),
    projects: SAMPLE_PROJECTS,
  },
};

export const NextUp: Story = {
  args: {
    task: makeTask({
      title: "Reply to the recruiter",
      priority: "p3",
      status: "next",
    }),
  },
};

export const Cancelled: Story = {
  args: {
    task: makeTask({
      title: "Attend the offsite (cancelled)",
      priority: "p4",
      status: "cancelled",
    }),
  },
};

// ── Scheduling edge cases ──────────────────────────────────────────────

export const SoftBucket: Story = {
  name: "Soft bucket (someday)",
  args: {
    task: makeTask({
      title: "Read that systems-design book",
      priority: "p4",
      when_bucket: "someday",
    }),
  },
};

export const DoDateWithDeadline: Story = {
  name: "Do-date + separate hard deadline",
  args: {
    task: makeTask({
      title: "Finish the grant application",
      priority: "p1",
      when_date: tomorrow,
      due_date: nextWeek,
      duration_minutes: 120,
    }),
  },
};

// ── Content overflow edge cases ────────────────────────────────────────

export const LongTitle: Story = {
  args: {
    task: makeTask({
      title:
        "Investigate why the nightly sync job intermittently drops a handful of recurring tasks when the timezone offset changes during daylight-saving transitions",
      priority: "p2",
      due_date: today,
    }),
  },
};

export const ManyTags: Story = {
  args: {
    task: makeTask({
      title: "Plan the launch",
      priority: "p2",
      tags: ["launch", "marketing", "urgent", "q3", "cross-team", "review"],
      project_id: "proj-3",
      duration_minutes: 45,
    }),
    projects: SAMPLE_PROJECTS,
  },
};

// ── Gallery: a representative row stack (single change → many rows shift) ──

export const Gallery: Story = {
  name: "Gallery (mixed rows)",
  args: { task: makeTask({ title: "Fix critical login bug", priority: "p1", due_date: yesterday }) },
  render: () => (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      <TaskItem
        task={makeTask({ title: "Fix critical login bug", priority: "p1", due_date: yesterday, tags: ["urgent"] })}
      />
      <TaskItem
        task={makeTask({
          title: "Review pull request",
          priority: "p2",
          status: "in_progress",
          due_date: today,
          due_time: "14:00",
          duration_minutes: 60,
          project_id: "proj-1",
        })}
        projects={SAMPLE_PROJECTS}
      />
      <TaskItem
        task={makeTask({
          title: "Team standup",
          priority: "p2",
          due_date: today,
          due_time: "09:30",
          duration_minutes: 30,
          recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        })}
      />
      <TaskItem
        task={makeTask({ title: "Buy groceries", priority: "p3", when_date: tomorrow, when_time: "15:00", project_id: "proj-2" })}
        projects={SAMPLE_PROJECTS}
      />
      <TaskItem task={makeTask({ title: "Schedule dentist appointment", priority: "p4", status: "inbox" })} />
      <TaskItem task={makeTask({ title: "Deploy v2 release", priority: "p1", status: "done" })} />
    </div>
  ),
};
