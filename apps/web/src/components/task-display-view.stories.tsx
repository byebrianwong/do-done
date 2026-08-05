import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import { DEFAULT_DISPLAY, type DisplayConfig } from "@do-done/shared";
import { TaskDisplayView } from "./task-display-view";
import { SAMPLE_PROJECTS, SAMPLE_TASKS } from "./__stories__/mocks";

/** Pre-seed a view's persisted DisplayConfig, as a returning user would have. */
function seedDisplay(viewKey: string, over: Partial<DisplayConfig>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    `dodone.display.${viewKey}`,
    JSON.stringify({ ...DEFAULT_DISPLAY, ...over })
  );
}

const meta: Meta<typeof TaskDisplayView> = {
  title: "Components/TaskDisplayView",
  component: TaskDisplayView,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
    layout: "fullscreen",
  },
  decorators: [
    (Story) => {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("dodone.display.inbox-demo");
        window.localStorage.removeItem("dodone.display.all-demo");
        window.localStorage.removeItem("dodone.display.compact-demo");
        window.localStorage.removeItem("dodone.display.comfortable-demo");
      }
      return (
        <div className="mx-auto min-h-screen max-w-3xl bg-white p-6 dark:bg-neutral-900">
          <Story />
        </div>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Title-less layout used by pages that render their own heading (Inbox, Project).
export const MenuOnly: Story = {
  args: {
    viewKey: "inbox-demo",
    tasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
};

export const WithTitle: Story = {
  args: {
    viewKey: "all-demo",
    title: "All tasks",
    subtitle: `${SAMPLE_TASKS.length} total.`,
    tasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
};

/**
 * Compact density, grouped by project — the case the mode exists for: enough
 * projects that the group chrome, not the tasks, is what fills the screen.
 * Seeded through localStorage (a story decorator, so it runs after the meta
 * decorator's clear) because that's the same path a returning user takes.
 */
export const CompactDensity: Story = {
  args: {
    viewKey: "compact-demo",
    title: "All tasks",
    subtitle: `${SAMPLE_TASKS.length} total.`,
    tasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
  decorators: [
    (Story) => {
      seedDisplay("compact-demo", { group: "project", density: "compact" });
      return <Story />;
    },
  ],
};

/** The same list at the default density, for side-by-side comparison. */
export const ComfortableDensity: Story = {
  args: {
    viewKey: "comfortable-demo",
    title: "All tasks",
    subtitle: `${SAMPLE_TASKS.length} total.`,
    tasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
  decorators: [
    (Story) => {
      seedDisplay("comfortable-demo", { group: "project", density: "comfortable" });
      return <Story />;
    },
  ],
};

/** Flipping density from the menu, the way a user first finds it. */
export const SwitchToCompact: Story = {
  args: {
    viewKey: "inbox-demo",
    tasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /display/i }));
    await userEvent.click(canvas.getByRole("button", { name: "Compact" }));
  },
};

// The Display menu open over the reusable view — the change Inbox/Project gain.
export const WithDisplayMenuOpen: Story = {
  args: {
    viewKey: "inbox-demo",
    tasks: SAMPLE_TASKS,
    projects: SAMPLE_PROJECTS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /display/i }));
  },
};
