import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { waitFor, within } from "storybook/test";
import {
  CommandPalette,
  OPEN_COMMAND_PALETTE_EVENT,
} from "./command-palette";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

/**
 * The ⌘K command palette. It renders nothing until opened, so every story
 * dispatches the open event in `play` (the same event the mobile search button
 * fires). With an empty query it shows Navigation / Projects / Actions; we
 * don't type, because task search needs a live Supabase session.
 */
const meta: Meta<typeof CommandPalette> = {
  title: "Components/CommandPalette",
  component: CommandPalette,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/today" } },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

async function openPalette(canvasElement: HTMLElement) {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
  const canvas = within(canvasElement);
  await waitFor(() =>
    canvas.getByPlaceholderText(/search tasks, navigate/i)
  );
}

// Navigation + the three sample projects + actions.
export const Open: Story = {
  args: { projects: SAMPLE_PROJECTS },
  play: async ({ canvasElement }) => openPalette(canvasElement),
};

// No projects yet — only Navigation and Actions sections render.
export const NoProjects: Story = {
  name: "Open (no projects)",
  args: { projects: [] },
  play: async ({ canvasElement }) => openPalette(canvasElement),
};
