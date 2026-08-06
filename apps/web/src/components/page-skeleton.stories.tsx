import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  PageSkeleton,
  SkeletonBar,
  SkeletonList,
  SkeletonTaskRows,
} from "./page-skeleton";

/**
 * What every `(app)` route's `loading.tsx` renders. In the app these are only
 * on screen for as long as a navigation takes, which is exactly why they need a
 * home here — it's the one place they can be looked at properly.
 *
 * Each story is the fallback for the route it's named after, so a diff against
 * the real page tells you whether the swap will shift.
 */
const meta: Meta<typeof PageSkeleton> = {
  title: "Components/PageSkeleton",
  component: PageSkeleton,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="p-4 sm:p-6 lg:p-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Inbox: Story = {
  args: { title: "Inbox", children: <SkeletonList rows={5} /> },
};

export const Today: Story = {
  args: {
    title: "Today",
    children: (
      <>
        <SkeletonBar className="mb-4 h-20 w-full rounded-xl" />
        <SkeletonBar className="mb-4 h-11 w-full rounded-xl" />
        <SkeletonTaskRows rows={6} />
      </>
    ),
  },
};

export const Completed: Story = {
  args: {
    title: "Completed",
    children: <SkeletonList rows={6} quickAdd={false} />,
  },
};

export const Projects: Story = {
  args: {
    title: "Projects",
    children: (
      <div className="animate-pulse grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonBar key={i} className="h-[86px] w-full rounded-xl" />
        ))}
      </div>
    ),
  },
};

/**
 * The detail routes are titled by data the fallback doesn't have, so the
 * heading is a bar rather than a guess at the project's or task's name.
 */
export const UntitledDetailRoute: Story = {
  args: { children: <SkeletonList rows={6} /> },
};
