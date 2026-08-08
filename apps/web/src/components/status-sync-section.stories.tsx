import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DEFAULT_STATUS_SYNC } from "@do-done/shared";
import { StatusSyncSection } from "@/app/(app)/settings/status-sync-section";

const meta: Meta<typeof StatusSyncSection> = {
  title: "Settings/StatusSyncSection",
  component: StatusSyncSection,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/settings" } },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl bg-neutral-50 p-6 dark:bg-neutral-950">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** How the card looks before anyone has touched it — both rules off. */
export const Off: Story = {
  args: { settings: DEFAULT_STATUS_SYNC },
};

/** The setup the feature was asked for: within 3 days → Next, and back. */
export const BothRulesOn: Story = {
  args: {
    settings: {
      ...DEFAULT_STATUS_SYNC,
      status_sync_promote: true,
      status_sync_backfill: true,
    },
  },
};

/** A weekday-anchored window rather than a day count. */
export const WeekendHorizon: Story = {
  args: {
    settings: {
      ...DEFAULT_STATUS_SYNC,
      status_sync_promote: true,
      status_sync_backfill: true,
      status_sync_horizon_kind: "quick",
      status_sync_horizon_key: "this_weekend",
    },
  },
};

/** Only the status→date half, aimed at In progress. */
export const BackfillOnly: Story = {
  args: {
    settings: {
      ...DEFAULT_STATUS_SYNC,
      status_sync_backfill: true,
      status_sync_status: "in_progress",
      status_sync_horizon_days: 1,
    },
  },
};
