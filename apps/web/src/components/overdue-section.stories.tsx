import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { OverdueSection } from "./overdue-section";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

const yesterday = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
})();
const lastWeek = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split("T")[0];
})();

const meta: Meta<typeof OverdueSection> = {
  title: "Components/OverdueSection",
  component: OverdueSection,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/today" } },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl bg-white p-4 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { tasks: [] },
};

export const Single: Story = {
  args: {
    tasks: [
      makeTask({
        title: "Pay credit card bill",
        priority: "p1",
        when_date: yesterday,
      }),
    ],
    projects: SAMPLE_PROJECTS,
  },
};

export const Multiple: Story = {
  args: {
    tasks: [
      makeTask({
        title: "Pay credit card bill",
        priority: "p1",
        when_date: yesterday,
      }),
      makeTask({
        title: "Submit quarterly report",
        priority: "p2",
        due_date: lastWeek,
      }),
      makeTask({
        title: "Send invoice to client",
        priority: "p3",
        when_date: lastWeek,
      }),
      makeTask({
        title: "Review old draft",
        priority: "p4",
        due_date: yesterday,
      }),
    ],
    projects: SAMPLE_PROJECTS,
  },
};
