import type { Meta, StoryObj } from "@storybook/nextjs-vite";
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
