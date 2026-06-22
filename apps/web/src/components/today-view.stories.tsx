import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import { TodayView } from "./today-view";
import { makeTask, SAMPLE_PROJECTS, SAMPLE_TASKS } from "./__stories__/mocks";

// Frozen Storybook clock → "today" is 2026-01-15 (see .storybook/freeze-clock).
const TODAY = new Date().toISOString().split("T")[0];

// Demonstrates the auto + manual-pins model: a low-priority task pinned *into*
// Focus, and an urgent task the user pushed *out* of Focus down to Other tasks.
const FOCUS_PINS_TASKS = [
  makeTask({
    title: "Tidy the garage (pinned into Focus)",
    priority: "p4",
    focus_override: "include",
  }),
  makeTask({
    title: "Finish the quarterly deck",
    priority: "p1",
    status: "in_progress",
    due_date: TODAY,
  }),
  makeTask({ title: "Reply to investor email", priority: "p2", due_date: TODAY }),
  makeTask({
    title: "Skim the newsletter (pushed out of Focus)",
    priority: "p1",
    when_date: TODAY,
    focus_override: "exclude",
  }),
  makeTask({ title: "Pick up dry cleaning", priority: "p3", when_date: TODAY }),
];

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

// Auto + manual pins: Focus is drag-editable. Here a low-priority chore is
// pinned in (focus_override: "include") and an urgent task is pushed out
// (focus_override: "exclude") so it sits under Other tasks instead.
export const FocusWithManualPins: Story = {
  args: {
    allTasks: FOCUS_PINS_TASKS,
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

// Collapsed Focus section: clicking the Focus header hides its rows (chevron
// points right, count stays). State persists in the view's Display config.
export const FocusCollapsed: Story = {
  args: {
    allTasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // findByRole waits for the curated Focus section to mount before clicking.
    const focus = await canvas.findByRole("button", { name: /^Focus/i });
    await userEvent.click(focus);
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
