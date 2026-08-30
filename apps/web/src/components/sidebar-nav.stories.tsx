import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarNav } from "./sidebar-nav";
import { SAMPLE_PROJECTS } from "./__stories__/mocks";

const meta: Meta<typeof SidebarNav> = {
  title: "Components/SidebarNav",
  component: SidebarNav,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true },
  },
  decorators: [
    (Story) => (
      <aside className="flex h-screen w-64 flex-col border-r border-neutral-200 bg-neutral-50">
        <div className="flex h-14 items-center px-5">
          <span className="text-xl font-bold text-indigo-500">DoDone</span>
        </div>
        <Story />
      </aside>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InboxActive: Story = {
  parameters: { nextjs: { navigation: { pathname: "/inbox" } } },
};

export const TodayActive: Story = {
  parameters: { nextjs: { navigation: { pathname: "/today" } } },
};

export const CalendarActive: Story = {
  parameters: { nextjs: { navigation: { pathname: "/calendar" } } },
};

// The project list is drag-to-reorder; hovering a row reveals the grip handle.
export const WithProjects: Story = {
  args: { projects: SAMPLE_PROJECTS },
};

export const ProjectActive: Story = {
  args: { projects: SAMPLE_PROJECTS },
  parameters: { nextjs: { navigation: { pathname: "/projects/proj-2" } } },
};

/**
 * The projects read failed, so the section says so rather than rendering an
 * empty list. An empty sidebar is a claim about the account, and during the
 * Supabase outage it was a false one.
 */
export const ProjectsUnavailable: Story = {
  args: { projects: [], projectsUnavailable: true },
};
