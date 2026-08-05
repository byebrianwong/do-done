import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import { addDaysLocalISO } from "@do-done/shared";
import { UpcomingView } from "./upcoming-view";
import { makeTask, SAMPLE_PROJECTS, SAMPLE_TASKS } from "./__stories__/mocks";

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

// A backlog of overdue tasks: the Overdue group grows a "Reschedule all"
// toolbar (Today / Tomorrow / Next week) in its header, mirroring the Today
// view so the whole backlog can be cleared in one tap.
const OVERDUE_BACKLOG = [
  makeTask({
    title: "Pay credit card bill",
    priority: "p1",
    scheduled_date: addDaysLocalISO(-1),
  }),
  makeTask({
    title: "Submit quarterly report",
    priority: "p2",
    deadline_date: addDaysLocalISO(-3),
  }),
  makeTask({
    title: "Reply to landlord",
    priority: "p3",
    scheduled_date: addDaysLocalISO(-5),
  }),
  makeTask({
    title: "Renew car registration",
    priority: "p2",
    deadline_date: addDaysLocalISO(-8),
  }),
  ...SAMPLE_TASKS,
];

export const OverdueReschedule: Story = {
  args: {
    allTasks: OVERDUE_BACKLOG,
    projects: SAMPLE_PROJECTS,
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
    // First "Status" button is the Group-by pill (precedes the Sort-by one,
    // which the menu grew when sorting by status was added). A bare getByRole
    // matches both and throws, which shows up as a capture error, not a
    // failing test — the story simply stops rendering.
    const statusPills = canvas.getAllByRole("button", { name: "Status" });
    await userEvent.click(statusPills[0]);
  },
};
