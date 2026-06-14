import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AllTasksView } from "./all-tasks-view";
import { SAMPLE_PROJECTS, SAMPLE_TASKS } from "./__stories__/mocks";

const meta: Meta<typeof AllTasksView> = {
  title: "Components/AllTasksView",
  component: AllTasksView,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/all" } },
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-white p-6 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    tasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
};
