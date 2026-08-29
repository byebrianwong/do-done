import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AppPreview } from "./app-preview";
import { withSettledMotion } from "./__stories__/settled";

/**
 * The hero's fake app window — the first picture of DoDone anyone sees.
 *
 * It exists here because it is *hand-built markup*, not the real components,
 * and that is exactly what makes it drift: the row was redesigned twice (the
 * gutter replaced four priority bars, the ring moved from priority to project)
 * and this mock kept advertising the old design both times, with nothing to
 * catch it. Under Chromatic, the next change to the real row shows up as a
 * diff here instead of as a marketing page quietly selling the wrong product.
 *
 * What to look for when a diff lands: the ring is the **project's** colour, the
 * mark left of it is **urgency** (a dot when overdue, then a bar whose length
 * falls with the rank, nothing for a P4), and the project chip has no colour
 * dot — the ring already said it. That is `task-item.tsx`'s row, and if this
 * stops matching it, this file is the thing that is wrong.
 */
const meta = {
  title: "Marketing/App preview",
  component: AppPreview,
  parameters: {
    layout: "padded",
  },
  decorators: [withSettledMotion],
} satisfies Meta<typeof AppPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * Phone width, where the row sheds its furniture: the tag, project name and
 * estimate are all `hidden sm:`/`md:`, so what is left is the gutter, the ring,
 * the title and the date. The two things this page is really claiming — which
 * project, how urgent — are the two that survive, which is why the row spends
 * its only two colour slots on them.
 */
export const Narrow: Story = {
  parameters: {
    chromatic: { viewports: [390] },
  },
};
