import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import AppError from "./error";

/**
 * What every page under `(app)` renders when a read fails.
 *
 * Worth a snapshot because it is the one screen whose *copy* is the fix: an
 * unreachable server used to render as an empty account, so this has to say
 * plainly that the data is still there.
 */
const meta: Meta<typeof AppError> = {
  title: "App/AppError",
  component: AppError,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof AppError>;

export const Default: Story = {
  args: {
    error: new Error("Could not load your tasks"),
    unstable_retry: () => {},
  },
};

/** In production Next replaces the message with a digest, which we surface. */
export const WithDigest: Story = {
  args: {
    error: Object.assign(new Error("Could not load your tasks"), {
      digest: "3891274655",
    }),
    unstable_retry: () => {},
  },
};
