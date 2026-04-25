import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TaskEditDialog } from "./task-edit-dialog";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

const meta: Meta<typeof TaskEditDialog> = {
  title: "Components/TaskEditDialog",
  component: TaskEditDialog,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const today = new Date().toISOString().split("T")[0];

export const NewTask: Story = {
  args: {
    task: makeTask({ title: "New task", priority: "p3" }),
    projects: SAMPLE_PROJECTS,
    open: true,
    onClose: () => {},
  },
};

export const FullyDetailedTask: Story = {
  args: {
    task: makeTask({
      title: "Weekly planning session",
      description: "Review the week, check goals, plan time blocks for next week.",
      priority: "p2",
      status: "todo",
      project_id: "proj-1",
      due_date: today,
      due_time: "16:30",
      duration_minutes: 60,
      tags: ["work", "weekly"],
      recurrence_rule: "FREQ=WEEKLY;BYDAY=FR",
    }),
    projects: SAMPLE_PROJECTS,
    open: true,
    onClose: () => {},
  },
};

export const HighPriority: Story = {
  args: {
    task: makeTask({
      title: "Critical bug fix",
      priority: "p1",
      status: "in_progress",
      tags: ["urgent"],
    }),
    projects: SAMPLE_PROJECTS,
    open: true,
    onClose: () => {},
  },
};

export const Closed: Story = {
  args: {
    task: makeTask(),
    projects: SAMPLE_PROJECTS,
    open: false,
    onClose: () => {},
  },
};
