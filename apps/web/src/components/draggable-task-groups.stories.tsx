import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DraggableTaskGroups } from "./draggable-task-groups";
import { DEFAULT_DISPLAY, type DisplayConfig } from "@do-done/shared";
import { SAMPLE_PROJECTS, SAMPLE_TASKS } from "./__stories__/mocks";

// Renders the grouped/sorted output of the Display engine for a given config,
// so Chromatic captures each grouping mode directly (no interaction needed).
const meta: Meta<typeof DraggableTaskGroups> = {
  title: "Components/DraggableTaskGroups",
  component: DraggableTaskGroups,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/all" } },
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl bg-white p-6 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const cfg = (o: Partial<DisplayConfig>): DisplayConfig => ({ ...DEFAULT_DISPLAY, ...o });
const base = { tasks: SAMPLE_TASKS, projects: SAMPLE_PROJECTS };

export const GroupedByStatus: Story = { args: { ...base, config: cfg({ group: "status" }) } };
export const GroupedByPriority: Story = { args: { ...base, config: cfg({ group: "priority" }) } };
export const GroupedByProject: Story = { args: { ...base, config: cfg({ group: "project" }) } };
export const GroupedByDate: Story = { args: { ...base, config: cfg({ group: "date" }) } };

// groupDir: "desc" reverses the group order (status lifecycle flipped) while the
// "No project"-style catch-all buckets stay pinned to the bottom.
export const GroupedByStatusReversed: Story = {
  args: { ...base, config: cfg({ group: "status", groupDir: "desc" }) },
};
export const GroupedByProjectReversed: Story = {
  args: { ...base, config: cfg({ group: "project", groupDir: "desc" }) },
};

// A collapsed section ("Not started") hides its rows and shows a right-pointing
// chevron; the header + count stay. (No onConfigChange here, so it's render-only.)
export const GroupWithCollapsedSection: Story = {
  args: {
    ...base,
    config: cfg({ group: "status", collapsed: ["status:not_started"] }),
  },
};

// Non-manual sort renders a flat, static (non-draggable) list.
export const SortedByDeadlineDate: Story = {
  args: { ...base, config: cfg({ group: "none", sort: [{ field: "deadline_date", dir: "asc" }] }) },
};
