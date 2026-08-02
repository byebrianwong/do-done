import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LinkifiedText } from "./linkified-text";

const meta: Meta<typeof LinkifiedText> = {
  title: "Components/LinkifiedText",
  component: LinkifiedText,
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-xl bg-white p-6 text-sm text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const UrlInTitle: Story = {
  args: { text: "Buy dog food https://www.example.com/" },
};

export const BareWwwLink: Story = {
  args: { text: "Order from www.example.com before Friday" },
};

export const TrailingPunctuation: Story = {
  args: { text: "Read the RFC at https://example.com/spec, then reply." },
};

export const MultipleLinks: Story = {
  args: { text: "Compare https://a.example.com and https://b.example.com" },
};

export const NoLink: Story = {
  args: { text: "Buy dog food" },
};
