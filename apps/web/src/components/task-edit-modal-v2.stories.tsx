import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TaskEditModalV2 } from "./task-edit-modal-v2";
import { makeTask } from "./__stories__/mocks";

const meta: Meta<typeof TaskEditModalV2> = {
  title: "Components/TaskEditModalV2",
  component: TaskEditModalV2,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const today = new Date().toISOString().split("T")[0];
const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
})();

export const Default: Story = {
  args: {
    task: makeTask({
      title: "Ship widget v2",
      priority: "p2",
      when_date: tomorrow,
      duration_minutes: 120,
      tags: ["web", "design"],
    }),
    open: true,
    onClose: () => {},
  },
};

export const NotScheduled: Story = {
  args: {
    task: makeTask({ title: "Untitled task", priority: "p4" }),
    open: true,
    onClose: () => {},
  },
};

export const WithBucket: Story = {
  args: {
    task: makeTask({
      title: "Plan offsite",
      priority: "p3",
      when_bucket: "later",
      tags: ["planning"],
    }),
    open: true,
    onClose: () => {},
  },
};

export const HighPriorityToday: Story = {
  args: {
    task: makeTask({
      title: "Fix prod incident",
      priority: "p1",
      when_date: today,
      duration_minutes: 60,
      tags: ["urgent", "ops"],
    }),
    open: true,
    onClose: () => {},
  },
};

export const ManyTagsEditing: Story = {
  args: {
    task: makeTask({
      title: "Refactor onboarding",
      priority: "p3",
      when_bucket: "this_week",
      tags: ["frontend", "growth", "experiment", "needs-review"],
    }),
    open: true,
    onClose: () => {},
  },
};

export const NoTagsAffordance: Story = {
  args: {
    task: makeTask({
      title: "Write release notes",
      priority: "p4",
      tags: [],
    }),
    open: true,
    onClose: () => {},
  },
};

/**
 * The delete confirmation dialog, opened automatically. It centers over the
 * viewport (the underlying edit modal is dimmed + blurred behind it) instead
 * of the browser's native top-anchored confirm.
 */
export const ConfirmingDelete: Story = {
  args: {
    task: makeTask({
      title: "Texas Money",
      priority: "p4",
      tags: ["finance"],
    }),
    open: true,
    onClose: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByText("Delete"));
    await waitFor(() =>
      expect(canvas.getByText("Delete task?")).toBeInTheDocument()
    );
  },
};
