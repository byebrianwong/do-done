import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import type { Task } from "@do-done/shared";
import { TaskDisplayView } from "./task-display-view";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

// Mirrors what the Completed page renders: a TaskDisplayView over done tasks,
// defaulting to a flat list newest-first by completion date.
const COMPLETED_TASKS: Task[] = [
  makeTask({ title: "Deploy v2 release", priority: "p1", status: "done", completed_at: "2026-06-14T15:00:00.000Z", tags: ["work"], project_id: "proj-1" }),
  makeTask({ title: "Write release notes", priority: "p3", status: "done", completed_at: "2026-06-14T11:30:00.000Z", project_id: "proj-1" }),
  makeTask({ title: "Pay credit card bill", priority: "p1", status: "done", completed_at: "2026-06-13T09:00:00.000Z", tags: ["finance"] }),
  makeTask({ title: "Buy groceries for the week", priority: "p3", status: "done", completed_at: "2026-06-12T18:45:00.000Z", tags: ["groceries"], project_id: "proj-2" }),
  makeTask({ title: "Book dentist appointment", priority: "p4", status: "done", completed_at: "2026-06-09T13:20:00.000Z" }),
];

function CompletedView({ tasks }: { tasks: Task[] }) {
  return (
    <div className="mx-auto max-w-3xl">
      <TaskDisplayView
        viewKey="completed"
        title="Completed"
        subtitle="Click a task to reopen it."
        tasks={tasks}
        projects={SAMPLE_PROJECTS}
        emptyText="Nothing here yet — complete a task and it’ll land here."
      />
    </div>
  );
}

const meta: Meta<typeof CompletedView> = {
  title: "Components/CompletedView",
  component: CompletedView,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/completed" } },
    layout: "fullscreen",
  },
  decorators: [
    (Story) => {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("dodone.display.completed");
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
  args: { tasks: COMPLETED_TASKS },
};

export const WithDisplayMenuOpen: Story = {
  args: { tasks: COMPLETED_TASKS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /display/i }));
  },
};
