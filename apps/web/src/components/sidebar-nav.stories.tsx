import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarNav } from "./sidebar-nav";

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
          <span className="text-xl font-bold text-indigo-500">do-done</span>
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
