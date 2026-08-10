import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { LandingPage } from "./landing-page";
import { withSettledMotion } from "./__stories__/settled";

/**
 * The public front door, whole.
 *
 * This is the marketing tier of the story set, and it earns a page-level
 * snapshot for the same reason `Pages` does: a change to a token, the priority
 * ramp or the task row ripples through the hero, and the blast radius is only
 * visible when the whole thing is on screen at once. It is also the only route
 * in the product a stranger sees, and until now the only surface with no
 * snapshot at all — which is precisely how its fake screenshot came to
 * advertise a row design the app had abandoned twice over.
 *
 * The sign-in form mounts for real. It calls `createClientSupabase()`, which
 * Storybook reroutes to the deep-Proxy stub in `.storybook/main.ts`, so the
 * card renders its resting state and no story needs an account.
 */
const meta = {
  title: "Marketing/Landing page",
  component: LandingPage,
  parameters: {
    layout: "fullscreen",
    // The sign-in card calls `useRouter` to send you on after a successful
    // sign-in, and without the App Router context that is a hard render error
    // ("invariant expected app router to be mounted") — the whole page, not
    // just the card. `/` because this is the one route that is the front door.
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
  },
  decorators: [withSettledMotion],
} satisfies Meta<typeof LandingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * What a stranger gets: the demo is the primary call to action in the header,
 * the hero and the last section, with the sign-in form where a returning user
 * would look for it.
 */
export const SignedOut: Story = {
  args: { signedIn: false },
};

/**
 * The same page for someone who already has a session — every "Check it out" /
 * "Sign in" pair collapses into a way back into the app. Worth its own snapshot
 * because it is the state nobody looks at while editing the marketing copy, and
 * a call to action that still says "Sign in" to a signed-in reader is the kind
 * of thing that survives for months.
 */
export const SignedIn: Story = {
  args: { signedIn: true },
};

/**
 * Phone width — where most first visits land, and where the hero's app window
 * has to hold up at a third of the width it was designed at.
 */
export const Mobile: Story = {
  args: { signedIn: false },
  parameters: {
    chromatic: { viewports: [390] },
  },
};
