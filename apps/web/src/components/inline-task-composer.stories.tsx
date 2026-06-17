import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, waitFor, within } from "storybook/test";
import { InlineTaskComposer } from "./inline-task-composer";

/**
 * The per-section inline quick-add. Collapsed it's a faint "Add task" affordance
 * revealed on the section's hover; expanded it's a natural-language input with a
 * live parsed-chip preview. Stories with an expanded state drive it via `play`.
 */
const meta: Meta<typeof InlineTaskComposer> = {
  title: "Components/InlineTaskComposer",
  component: InlineTaskComposer,
  parameters: {
    layout: "padded",
    nextjs: { appDirectory: true, navigation: { pathname: "/all" } },
  },
  decorators: [
    (Story) => (
      <div className="group mx-auto max-w-2xl bg-white p-6 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Collapsed affordance. It's hover-revealed in the app; force it visible here so
// Chromatic captures the resting state.
export const Collapsed: Story = {
  args: { seed: {} },
  decorators: [
    (Story) => (
      <div className="[&_button]:!opacity-100">
        <Story />
      </div>
    ),
  ],
};

export const Expanded: Story = {
  args: { seed: { priority: "p1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /add task/i }));
    await waitFor(() => canvas.getByLabelText(/add a task/i));
  },
};

export const ExpandedWithChips: Story = {
  args: { seed: { project_id: "proj-1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /add task/i }));
    const input = await waitFor(() => canvas.getByLabelText(/add a task/i));
    // Stable tokens only (no date phrases) so the snapshot doesn't drift daily.
    await userEvent.type(input, "Email the team p1 #work #m");
  },
};
