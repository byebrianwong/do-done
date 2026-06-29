import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { resolveQuickSchedule } from "@do-done/shared";
import { TaskContextMenu } from "./task-context-menu";
import { UndoToastProvider } from "./undo-toast";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

const TODAY = resolveQuickSchedule("today");
const YESTERDAY = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
})();

const meta: Meta<typeof TaskContextMenu> = {
  title: "Components/TaskContextMenu",
  component: TaskContextMenu,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
  },
  args: {
    projects: SAMPLE_PROJECTS,
    onEdit: () => {},
    onClose: () => {},
    onMutated: () => {},
  },
  decorators: [
    (Story) => (
      <UndoToastProvider>
        <div className="flex min-h-[560px] items-start justify-center bg-neutral-50 p-8 dark:bg-neutral-900">
          <Story />
        </div>
      </UndoToastProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Scheduled for today, high priority, in a project, with a 1-hour estimate —
// shows the "Today", "P2", and "1h" selections lit at once.
export const Default: Story = {
  args: {
    task: makeTask({
      title: "Draft Q3 launch email",
      priority: "p2",
      when_date: TODAY,
      duration_minutes: 60,
      project_id: "proj-1",
    }),
  },
};

// Bare inbox task: nothing scheduled, no estimate, no project — every section
// reads as "unset" so you can see the empty state.
export const Unscheduled: Story = {
  args: {
    task: makeTask({
      title: "Schedule dentist appointment",
      priority: "p4",
      status: "inbox",
    }),
  },
};

// Overdue with a hard deadline (yesterday) and no do-date — open the Deadline
// row to see the date populated.
export const OverdueUrgent: Story = {
  args: {
    task: makeTask({
      title: "Pay credit card bill",
      priority: "p1",
      due_date: YESTERDAY,
      duration_minutes: 30,
      tags: ["finance"],
    }),
  },
};

// Already pinned into Today's Focus — the focus row reads "Remove from Focus".
export const PinnedToFocus: Story = {
  args: {
    task: makeTask({
      title: "Finish the quarterly report",
      priority: "p1",
      when_date: TODAY,
      duration_minutes: 120,
      focus_override: "include",
      project_id: "proj-1",
    }),
  },
};
