import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect } from "react";
import { UndoToastProvider, useUndoToast } from "./undo-toast";

function Trigger({ message }: { message: string }) {
  const toast = useUndoToast();
  useEffect(() => {
    toast.show({
      message,
      undo: () => console.log("undo clicked"),
    });
  }, [toast, message]);
  return (
    <div className="rounded-md border border-neutral-200 p-4 text-sm text-neutral-500 dark:border-neutral-800">
      Toast was triggered on mount. It auto-dismisses after 6 seconds.
    </div>
  );
}

const meta: Meta = {
  title: "Components/UndoToast",
  decorators: [
    (Story) => (
      <UndoToastProvider>
        <div className="mx-auto max-w-md bg-white p-6 dark:bg-neutral-900">
          <Story />
        </div>
      </UndoToastProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <Trigger message={`Completed “Review pull request”`} />,
};

export const LongMessage: Story = {
  render: () => (
    <Trigger message={`Completed “Plan the quarterly engineering retreat in Lisbon”`} />
  ),
};
