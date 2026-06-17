import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QuickAddFab } from "./quick-add-fab";

/**
 * Floating "new task" button. Captured at a wide (xl) viewport so the
 * pet-panel clearance offset (`xl:right-[336px]`) is visible when a panel is
 * present.
 */
const meta: Meta<typeof QuickAddFab> = {
  title: "Components/QuickAddFab",
  component: QuickAddFab,
  parameters: {
    layout: "fullscreen",
    chromatic: { viewports: [1366] },
  },
  decorators: [
    (Story) => (
      <div className="relative min-h-[260px] bg-neutral-50 dark:bg-neutral-950">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Bottom-right corner.
export const Default: Story = { args: { hasPetPanel: false } };

// Offset left of the 320px pet-panel column on xl+.
export const ClearsPetPanel: Story = { args: { hasPetPanel: true } };
