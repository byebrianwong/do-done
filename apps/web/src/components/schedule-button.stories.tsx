import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ScheduleButton } from "./schedule-button";

const meta: Meta<typeof ScheduleButton> = {
  title: "Components/ScheduleButton",
  component: ScheduleButton,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
  },
  decorators: [
    (Story) => (
      <div className="flex h-64 items-start justify-center bg-white p-6 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    taskId: "task-1",
    durationMinutes: 60,
  },
};

export const ShortTask: Story = {
  args: {
    taskId: "task-2",
    durationMinutes: 30,
  },
};

export const LongTask: Story = {
  args: {
    taskId: "task-3",
    durationMinutes: 120,
  },
};
