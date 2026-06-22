import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PetRevealTab } from "./PetRevealTab";

// The collapsed-state tab that brings Pip back. In the app it's fixed to the
// right edge; here it's framed against a neutral surface so the tab's own look
// (cream pill, paw, vertical label) is what gets snapshotted.
const meta: Meta<typeof PetRevealTab> = {
  title: "Pet/PetRevealTab",
  component: PetRevealTab,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: 24,
          backgroundColor: "#f3f4f6",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    onShow: () => {
      // no-op for stories
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
