import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, waitFor, within } from "storybook/test";
import { QuickAddModal } from "./quick-add-modal";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

/**
 * The universal quick-add modal. It renders nothing until opened, so each story
 * opens it with the global "q" shortcut (an instrumented user event — a raw
 * window event dispatch doesn't reliably flush before capture). A single
 * natural-language input plus When / Priority / Project / Estimate chips, and a
 * "More options" escape hatch to the full editor.
 */
const meta: Meta<typeof QuickAddModal> = {
  title: "Components/QuickAddModal",
  component: QuickAddModal,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/today" } },
  },
  args: { projects: SAMPLE_PROJECTS, userId: "user-1" },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard("q");
    await waitFor(() => within(canvasElement).getByRole("dialog"));
  },
};

export const WithInput: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard("q");
    const canvas = within(canvasElement);
    const dialog = await waitFor(() => canvas.getByRole("dialog"));
    // Stable tokens only (no date phrases) so the snapshot doesn't drift daily.
    await userEvent.type(within(dialog).getByLabelText("Task title"), "Pay rent p1 #home");
  },
};
