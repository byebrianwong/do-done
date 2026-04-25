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
