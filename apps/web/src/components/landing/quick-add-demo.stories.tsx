import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { QuickAddDemo } from "./quick-add-demo";
import { withSettledMotion } from "./__stories__/settled";

/**
 * The quick-add bar typing itself out, and the chips the parser gets from it.
 *
 * The claim this makes is checkable, which is why it is worth snapshotting: the
 * chips are asserted in the component's own comment to be what `parseTaskInput`
 * actually returns for that exact string. The one that matters is
 * "📅 Scheduled tomorrow" — a bare date is a *schedule*, and only "due" or
 * "deadline" makes a deadline. If someone relabels that chip to "Due
 * tomorrow", this page starts teaching the distinction the rest of the product
 * is built on, backwards.
 */
const meta = {
  title: "Marketing/Quick-add demo",
  component: QuickAddDemo,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof QuickAddDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The finished sentence with all four chips — the component's own
 * reduced-motion path, which skips the typewriter and shows the end state.
 *
 * This is the Chromatic baseline: the typing loop is a `setTimeout` chain that
 * wipes and restarts every ~6s, so snapshotting the animated version would
 * catch a different number of characters on every build.
 */
export const Default: Story = {
  decorators: [withSettledMotion],
};

/**
 * The real thing, typing. Not snapshotted — it is here to be watched, since the
 * whole point of the component is the *moment* a sentence becomes fields, and
 * no still frame carries that.
 */
export const Typing: Story = {
  parameters: {
    chromatic: { disableSnapshot: true },
  },
};
