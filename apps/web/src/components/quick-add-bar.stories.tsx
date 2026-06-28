import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, waitFor, within } from "storybook/test";
import { QuickAddBar } from "./quick-add-bar";
import { QuickAddProvider } from "@/lib/quick-add-context";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

/**
 * The top-of-page quick-add. Idle it's one clean line; focusing reveals the
 * attribute chips, an Add button, and an expand-to-editor affordance. The
 * Project chip only appears when a `QuickAddProvider` supplies projects + a
 * signed-in user.
 */
const meta: Meta<typeof QuickAddBar> = {
  title: "Components/QuickAddBar",
  component: QuickAddBar,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl bg-white p-6 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Resting state — a single clean line.
export const Idle: Story = {
  args: { seed: { status: "inbox" } },
};

// Focused: chips + Add button + expand affordance slide in (no Project chip
// without a provider).
export const Focused: Story = {
  args: { seed: { status: "inbox" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText(/add a task/i));
    await waitFor(() => canvas.getByRole("button", { name: /add task/i }));
  },
};

// With a provider, the Project chip joins the row; typing shows the slim
// parsed preview for the fields the chips don't cover.
export const WithProjectChip: Story = {
  args: { seed: { status: "not_started" } },
  decorators: [
    (Story) => (
      <QuickAddProvider projects={SAMPLE_PROJECTS} userId="user-1">
        <Story />
      </QuickAddProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText(/add a task/i);
    await userEvent.click(input);
    // Stable tokens only (no date phrases) so the snapshot doesn't drift daily.
    await userEvent.type(input, "Ship the release #work every monday");
    await waitFor(() => canvas.getByRole("button", { name: /add task/i }));
  },
};
