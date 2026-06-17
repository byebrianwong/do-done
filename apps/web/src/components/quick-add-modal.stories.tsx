import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import { QuickAddModal } from "./quick-add-modal";
import { OPEN_QUICK_ADD_EVENT } from "@/lib/quick-add-events";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

/**
 * The universal quick-add modal. It renders nothing until opened. Stories open
 * it by firing the open event from a mount effect on a thin wrapper: because
 * React runs child effects before parent effects, QuickAddModal's listener is
 * attached before the wrapper dispatches — deterministic, with no dependence on
 * focus or play-function timing (the `q` shortcut is guarded against firing
 * while a text field is focused, which Chromatic's capture can trigger).
 */
function OpenedQuickAdd(props: React.ComponentProps<typeof QuickAddModal>) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(OPEN_QUICK_ADD_EVENT));
  }, []);
  return <QuickAddModal {...props} />;
}

const meta: Meta<typeof QuickAddModal> = {
  title: "Components/QuickAddModal",
  component: QuickAddModal,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/today" } },
  },
  args: { projects: SAMPLE_PROJECTS, userId: "user-1" },
  render: (args) => <OpenedQuickAdd {...args} />,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByLabelText("Task title");
  },
};

export const WithInput: Story = {
  play: async ({ canvasElement }) => {
    const input = await within(canvasElement).findByLabelText("Task title");
    // Stable tokens only (no date phrases) so the snapshot doesn't drift daily.
    await userEvent.type(input, "Pay rent p1 #home");
  },
};
