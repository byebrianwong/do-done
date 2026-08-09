import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import { ProjectForm } from "./project-form";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

const meta: Meta<typeof ProjectForm> = {
  title: "Components/ProjectForm",
  component: ProjectForm,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/projects" } },
  },
  args: {
    onClose: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Create mode — name empty, first palette color preselected.
export const Create: Story = {};

// Edit mode — pre-filled name, color, and emoji icon; gains a Delete action.
export const Edit: Story = {
  args: {
    project: {
      ...SAMPLE_PROJECTS[0],
      name: "Engineering",
      color: "#6366f1",
      icon: "🚀",
    },
  },
};

// Edit a project that uses a non-default color from the palette.
export const EditPink: Story = {
  name: "Edit (pink, no icon)",
  args: {
    project: SAMPLE_PROJECTS[2],
  },
};

// The icon grid open. It expands in flow and the dialog body scrolls — the
// state that regressed when it was a floating panel, since the dialog clips.
export const IconPickerOpen: Story = {
  name: "Edit (icon picker open)",
  args: { project: { ...SAMPLE_PROJECTS[0], name: "Engineering", icon: "🚀" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /change/i }));
  },
};

// The symbols group: characters that are not emoji and take the row's own text
// colour. `icon` has always accepted them; nothing used to say so.
export const IconPickerSymbols: Story = {
  name: "Edit (icon picker, symbols)",
  args: { project: { ...SAMPLE_PROJECTS[0], name: "Engineering", icon: "★" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /change/i }));
    await userEvent.click(await canvas.findByRole("button", { name: "Symbols" }));
  },
};
