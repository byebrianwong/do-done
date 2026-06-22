import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import { UpcomingView } from "./upcoming-view";
import { SAMPLE_PROJECTS, SAMPLE_TASKS } from "./__stories__/mocks";

const meta: Meta<typeof UpcomingView> = {
  title: "Components/UpcomingView",
  component: UpcomingView,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/upcoming" } },
    layout: "fullscreen",
  },
  decorators: [
    (Story) => {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("dodone.display.upcoming");
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

// The curated default: per-day columns (No date · Today · Tomorrow · …).
export const Default: Story = {
  args: {
    allTasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
};

// The Display menu open over the per-day layout.
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

// Collapsed day: clicking a day header hides that day's rows (chevron points
// right). State persists in the view's Display config.
export const DayCollapsed: Story = {
  args: {
    allTasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // findByRole waits for the per-day columns to mount before clicking.
    const day = await canvas.findByRole("button", { name: /^No date/i });
    await userEvent.click(day);
  },
};

// Override: Group by → Status flips the per-day columns to the generic list.
export const OverrideGroupedByStatus: Story = {
  args: {
    allTasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /display/i }));
    await userEvent.click(canvas.getByRole("button", { name: "Status" }));
  },
};
