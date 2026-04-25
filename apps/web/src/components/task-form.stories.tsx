import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TaskForm } from "./task-form";

const meta: Meta<typeof TaskForm> = {
  title: "Components/TaskForm",
  component: TaskForm,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl bg-white p-6 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InboxMode: Story = {
  args: { defaultStatus: "inbox" },
};

export const TodoMode: Story = {
  args: { defaultStatus: "todo" },
};
