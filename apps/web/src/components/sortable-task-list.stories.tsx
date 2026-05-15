import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SortableTaskList } from "./sortable-task-list";
import { SAMPLE_TASKS, SAMPLE_PROJECTS } from "./__stories__/mocks";

const meta: Meta<typeof SortableTaskList> = {
  title: "Components/SortableTaskList",
  component: SortableTaskList,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/today" } },
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

export const FiveTasks: Story = {
  args: {
    tasks: SAMPLE_TASKS.filter((t) => t.status !== "done").slice(0, 5),
    projects: SAMPLE_PROJECTS,
  },
};

export const Empty: Story = {
  args: { tasks: [], projects: SAMPLE_PROJECTS },
};
