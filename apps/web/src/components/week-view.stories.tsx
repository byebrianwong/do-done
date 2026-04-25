import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { WeekView } from "./week-view";
import { makeTask, SAMPLE_PROJECTS, getMonday } from "./__stories__/mocks";
import type { Task } from "@do-done/shared";

const meta: Meta<typeof WeekView> = {
  title: "Components/WeekView",
  component: WeekView,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/calendar" } },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-7xl p-6">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const monday = new Date(getMonday());

function dayOffset(days: number): string {
  const d = new Date(monday);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

const busyWeek: Task[] = [
  makeTask({
    title: "Team standup",
    priority: "p2",
    due_date: dayOffset(0),
    due_time: "09:30",
    duration_minutes: 30,
    project_id: "proj-1",
  }),
  makeTask({
    title: "Design review",
    priority: "p2",
    due_date: dayOffset(0),
    due_time: "14:00",
    duration_minutes: 60,
    project_id: "proj-3",
  }),
  makeTask({
    title: "Deep work: refactor auth",
    priority: "p1",
    due_date: dayOffset(1),
    due_time: "10:00",
    duration_minutes: 120,
    project_id: "proj-1",
  }),
  makeTask({
    title: "1:1 with manager",
    priority: "p2",
    due_date: dayOffset(1),
    due_time: "15:00",
    duration_minutes: 30,
  }),
  makeTask({
    title: "Lunch with Alex",
    priority: "p3",
    due_date: dayOffset(2),
    due_time: "12:30",
    duration_minutes: 60,
    project_id: "proj-2",
  }),
  makeTask({
    title: "All-hands",
    priority: "p3",
    due_date: dayOffset(3),
    due_time: "11:00",
    duration_minutes: 60,
    project_id: "proj-1",
  }),
  makeTask({
    title: "Weekly retro",
    priority: "p3",
    due_date: dayOffset(4),
    due_time: "16:00",
    duration_minutes: 60,
    project_id: "proj-1",
    recurrence_rule: "FREQ=WEEKLY;BYDAY=FR",
  }),
  makeTask({
    title: "Plan next sprint",
    priority: "p1",
    due_date: dayOffset(0),
    due_time: "16:30",
    duration_minutes: 90,
    project_id: "proj-1",
  }),
];

export const BusyWeek: Story = {
  args: {
    weekStart: monday.toISOString(),
    tasks: busyWeek,
    projects: SAMPLE_PROJECTS,
  },
};

export const Empty: Story = {
  args: {
    weekStart: monday.toISOString(),
    tasks: [],
    projects: SAMPLE_PROJECTS,
  },
};

export const SparseTasks: Story = {
  args: {
    weekStart: monday.toISOString(),
    tasks: [
      makeTask({
        title: "Doctor appointment",
        priority: "p2",
        due_date: dayOffset(2),
        due_time: "10:00",
        duration_minutes: 30,
      }),
      makeTask({
        title: "Workout",
        priority: "p3",
        due_date: dayOffset(4),
        due_time: "07:00",
        duration_minutes: 45,
      }),
    ],
    projects: SAMPLE_PROJECTS,
  },
};

export const CompletedTasks: Story = {
  name: "Completed (rendered with reduced opacity)",
  args: {
    weekStart: monday.toISOString(),
    tasks: [
      makeTask({
        title: "Morning workout",
        priority: "p3",
        status: "done",
        due_date: dayOffset(0),
        due_time: "07:00",
        duration_minutes: 45,
      }),
      makeTask({
        title: "Standup",
        priority: "p2",
        status: "done",
        due_date: dayOffset(0),
        due_time: "09:30",
        duration_minutes: 30,
      }),
      makeTask({
        title: "Deep work block",
        priority: "p1",
        status: "todo",
        due_date: dayOffset(0),
        due_time: "10:30",
        duration_minutes: 120,
      }),
    ],
    projects: SAMPLE_PROJECTS,
  },
};
