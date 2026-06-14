import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
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
    (Story) => {
      // Reset persisted config so stories are deterministic in Chromatic.
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("dodone.display.all");
      }
      return (
        <div className="min-h-screen bg-white p-6 dark:bg-neutral-900">
          <Story />
        </div>
      );
    },
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

// The Display dropdown open over the All-tasks list — the headline change.
export const WithDisplayMenuOpen: Story = {
  args: {
    tasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /display/i }));
  },
};
