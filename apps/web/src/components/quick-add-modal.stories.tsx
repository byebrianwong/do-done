import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import { QuickAddModal } from "./quick-add-modal";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

/**
 * The universal quick-add modal. It renders nothing until opened, so each story
 * opens it with the global "q" shortcut (an instrumented user event) and waits
 * on the title input — mirroring the command-palette story, which opens via ⌘K
 * and finds its input by placeholder rather than by role.
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
    await within(canvasElement).findByLabelText("Task title");
  },
};

export const WithInput: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard("q");
    const input = await within(canvasElement).findByLabelText("Task title");
    // Stable tokens only (no date phrases) so the snapshot doesn't drift daily.
    await userEvent.type(input, "Pay rent p1 #home");
  },
};
