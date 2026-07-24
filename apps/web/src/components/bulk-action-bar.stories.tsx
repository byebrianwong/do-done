import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect } from "react";
import { waitFor, within } from "storybook/test";
import { BulkActionBar } from "./bulk-action-bar";
import { UndoToastProvider } from "./undo-toast";
import {
  TaskSelectionProvider,
  useTaskSelection,
} from "@/lib/task-selection";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

// Seed the selection after mount so the bar has something to show. A microtask
// (not an effect) sidesteps the provider's mount-time reset-on-navigation.
function Seeder({ count }: { count: number }) {
  const selection = useTaskSelection();
  useEffect(() => {
    queueMicrotask(() => {
      for (let i = 0; i < count; i++) {
        const id = `seed-${i}`;
        selection.registerTask(makeTask({ id, title: `Task ${i + 1}` }));
        selection.toggle(id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function Harness({ count }: { count: number }) {
  return (
    <UndoToastProvider>
      <TaskSelectionProvider>
        <Seeder count={count} />
        <div className="flex min-h-[280px] items-center justify-center text-sm text-neutral-400">
          The floating action bar appears once rows are selected.
        </div>
        <BulkActionBar projects={SAMPLE_PROJECTS} />
      </TaskSelectionProvider>
    </UndoToastProvider>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Components/BulkActionBar",
  component: Harness,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
  },
  decorators: [
    (Story) => (
      <div className="min-h-[380px] bg-neutral-50 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// A handful of tasks selected — the common case.
export const FewSelected: Story = {
  args: { count: 3 },
};

// A large multi-selection: the count pill scales without wrapping the bar.
export const ManySelected: Story = {
  args: { count: 24 },
};

// The "Move" popover opened, showing the project list rendered upward.
export const MoveMenuOpen: Story = {
  args: { count: 5 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const moveButton = await waitFor(() =>
      canvas.getByRole("button", { name: "Move" })
    );
    moveButton.click();
    await waitFor(() => canvas.getByRole("menu", { name: "Move" }));
  },
};
