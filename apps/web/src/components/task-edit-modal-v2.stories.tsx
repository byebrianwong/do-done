import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TaskEditModalV2 } from "./task-edit-modal-v2";
import { makeTask } from "./__stories__/mocks";

const meta: Meta<typeof TaskEditModalV2> = {
  title: "Components/TaskEditModalV2",
  component: TaskEditModalV2,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const today = new Date().toISOString().split("T")[0];
const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
})();
const twoDaysOut = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().split("T")[0];
})();
const nextWeek = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split("T")[0];
})();

export const Default: Story = {
  args: {
    task: makeTask({
      title: "Ship widget v2",
      priority: "p2",
      when_date: tomorrow,
      duration_minutes: 120,
      tags: ["web", "design"],
    }),
    open: true,
    onClose: () => {},
  },
};

/** Notes read as links until you click them, so a pasted URL stays followable. */
export const UrlInNotes: Story = {
  args: {
    task: makeTask({
      title: "Review the design doc",
      priority: "p2",
      description:
        "Spec: https://example.com/specs/widget-v2\nFigma at www.example.com/file/abc",
    }),
    open: true,
    onClose: () => {},
  },
};

export const NotScheduled: Story = {
  args: {
    task: makeTask({ title: "Untitled task", priority: "p4" }),
    open: true,
    onClose: () => {},
  },
};

export const ScheduledNextWeek: Story = {
  args: {
    task: makeTask({
      title: "Plan offsite",
      priority: "p3",
      when_date: nextWeek,
      tags: ["planning"],
    }),
    open: true,
    onClose: () => {},
  },
};

export const HighPriorityToday: Story = {
  args: {
    task: makeTask({
      title: "Fix prod incident",
      priority: "p1",
      when_date: today,
      duration_minutes: 60,
      tags: ["urgent", "ops"],
    }),
    open: true,
    onClose: () => {},
  },
};

export const ManyTagsEditing: Story = {
  args: {
    task: makeTask({
      title: "Refactor onboarding",
      priority: "p3",
      when_date: today,
      tags: ["frontend", "growth", "experiment", "needs-review"],
    }),
    open: true,
    onClose: () => {},
  },
};

export const NoTagsAffordance: Story = {
  args: {
    task: makeTask({
      title: "Write release notes",
      priority: "p4",
      tags: [],
    }),
    open: true,
    onClose: () => {},
  },
};

/**
 * Freezes the travelling band partway along the span.
 *
 * Chromatic pauses CSS animations at their first frame, and at t=0 the band is
 * still parked off the left edge — so without this the wave would never appear
 * in a snapshot. A negative delay plus `paused` pins it to a fixed, repeatable
 * moment mid-sweep instead.
 */
const frozenMidSweep: Decorator = (Story) => (
  <>
    <style>{`.dd-wave-band { animation-delay: -1150ms !important; animation-play-state: paused !important; }`}</style>
    <Story />
  </>
);

/**
 * The today → task-date span as a wave: a soft band of light travelling from
 * today to the selected day, over the runway tint. (The clock is frozen to Thu
 * 2026-01-15, so "two days out" lands on Saturday.)
 */
export const SpanWaveInWeek: Story = {
  decorators: [frozenMidSweep],
  args: {
    task: makeTask({
      title: "Draft the offsite agenda",
      priority: "p2",
      when_date: twoDaysOut,
      tags: ["planning"],
    }),
    open: true,
    onClose: () => {},
  },
};

/**
 * A span that wraps onto the second week row. Each row clips its own window
 * onto one shared coordinate space, so the band crosses the whole span exactly
 * once and reads as a single sweep rather than restarting on row two.
 */
export const SpanWrappedToNextRow: Story = {
  decorators: [frozenMidSweep],
  args: {
    task: makeTask({
      title: "Renew the domain",
      priority: "p3",
      when_date: nextWeek,
    }),
    open: true,
    onClose: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("today")).toBeInTheDocument());
    await expect(canvas.getByText(/in 1 week/)).toBeInTheDocument();
  },
};

/**
 * The month scroll view. The wave sits behind these 28px cells and glows
 * through them, which is why it works here where a drawn stroke would have cut
 * across the day numbers.
 */
export const SpanInMonthGrid: Story = {
  decorators: [frozenMidSweep],
  args: {
    task: makeTask({
      title: "Book the venue",
      priority: "p2",
      when_date: twoDaysOut,
    }),
    open: true,
    onClose: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByText(/See more dates/));
    await waitFor(() =>
      expect(canvas.getByText("scroll for more")).toBeInTheDocument()
    );
  },
};

/**
 * The due-date popover, opened automatically. Common deadlines are one tap
 * ("Same as task date" mirrors the do-date, plus Tomorrow / This weekend /
 * Next week); a native date input remains below for anything else.
 */
export const PickingDueDate: Story = {
  args: {
    task: makeTask({
      title: "Submit tax forms",
      priority: "p2",
      when_date: today,
      tags: ["finance"],
    }),
    open: true,
    onClose: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTitle("Set due date"));
    await waitFor(() =>
      expect(canvas.getByText("This weekend")).toBeInTheDocument()
    );
  },
};

/**
 * The do-time scroller, opened automatically. Half-hour slots auto-centered on
 * the hour nearest now; the precise native input is tucked behind "Specific
 * time" for the rare exact-minute case.
 */
export const PickingTime: Story = {
  args: {
    task: makeTask({
      title: "Stand-up call",
      priority: "p3",
      when_date: today,
      when_time: "09:00",
      tags: ["team"],
    }),
    open: true,
    onClose: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTitle("At 9:00 AM"));
    await waitFor(() =>
      expect(canvas.getByText(/Specific time/)).toBeInTheDocument()
    );
  },
};

/**
 * The delete confirmation dialog, opened automatically. It centers over the
 * viewport (the underlying edit modal is dimmed + blurred behind it) instead
 * of the browser's native top-anchored confirm.
 */
export const ConfirmingDelete: Story = {
  args: {
    task: makeTask({
      title: "Texas Money",
      priority: "p4",
      tags: ["finance"],
    }),
    open: true,
    onClose: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByText("Delete"));
    await waitFor(() =>
      expect(canvas.getByText("Delete task?")).toBeInTheDocument()
    );
  },
};
