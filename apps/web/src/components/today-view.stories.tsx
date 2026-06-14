import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
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
    (Story) => {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("dodone.display.today");
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

// The curated default: Overdue · Focus · Other tasks, now with a Display button.
export const Default: Story = {
  args: {
    allTasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
};

// The Display menu open over the curated layout.
export const WithDisplayMenuOpen: Story = {
  args: {
    allTasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /display/i }));
  },
};

// Override: changing Group by → Priority flips the curated layout to the
// generic grouped list (the menu's escape hatch).
export const OverrideGroupedByPriority: Story = {
  args: {
    allTasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /display/i }));
    // First "Priority" button is the Group-by pill (precedes the Sort-by one).
    const priorityPills = canvas.getAllByRole("button", { name: "Priority" });
    await userEvent.click(priorityPills[0]);
  },
};
