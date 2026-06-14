import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TodayView } from "./today-view";
import { SAMPLE_PROJECTS, SAMPLE_TASKS } from "./__stories__/mocks";

const meta: Meta<typeof TodayView> = {
  title: "Components/TodayView",
  component: TodayView,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/today" } },
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
    allTasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
};
