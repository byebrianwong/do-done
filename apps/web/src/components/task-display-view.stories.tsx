import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TaskDisplayView } from "./task-display-view";
import { SAMPLE_PROJECTS, SAMPLE_TASKS } from "./__stories__/mocks";

const meta: Meta<typeof TaskDisplayView> = {
  title: "Components/TaskDisplayView",
  component: TaskDisplayView,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="mx-auto min-h-screen max-w-3xl bg-white p-6 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Title-less layout used by pages that render their own heading (Inbox, Project).
export const MenuOnly: Story = {
  args: {
    viewKey: "inbox-demo",
    tasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
};

export const WithTitle: Story = {
  args: {
    viewKey: "all-demo",
    title: "All tasks",
    subtitle: `${SAMPLE_TASKS.length} total.`,
    tasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
};
