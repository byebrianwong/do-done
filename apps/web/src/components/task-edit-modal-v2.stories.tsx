import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { Project } from "@do-done/shared";
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

/**
 * Projects that actually carry an icon, so the cover has a watermark to draw.
 * `SAMPLE_PROJECTS` leaves `icon` null, which is the other case worth seeing —
 * `NoProjectIcon` below covers it.
 */
function project(over: Partial<Project> & { id: string }): Project {
  return {
    user_id: "user-1",
    name: "Project",
    color: "#6366f1",
    icon: null,
    parent_project_id: null,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

const MOBILE = project({
  id: "proj-mobile",
  name: "Mobile",
  color: "#6366f1",
  icon: "📱",
});
const HEALTH = project({
  id: "proj-health",
  name: "Health",
  color: "#10b981",
  icon: "🏃",
});
const HOME = project({
  id: "proj-home",
  name: "Home",
  color: "#f59e0b",
  icon: "🏠",
});

export const Default: Story = {
  args: {
    task: makeTask({
      title: "Ship widget v2",
      priority: "p2",
      scheduled_date: tomorrow,
      duration_minutes: 120,
      tags: ["web", "design"],
      project_id: MOBILE.id,
    }),
    projects: [MOBILE, HEALTH, HOME],
    open: true,
    onClose: () => {},
  },
};

/**
 * The cover takes its colour, emoji and texture from the project — so the same
 * editor announces which part of your life the task belongs to before you've
 * read the title. Texture is hashed off the project id, which is what keeps two
 * projects on neighbouring hues apart.
 */
export const CoverHealth: Story = {
  args: {
    task: makeTask({
      title: "Long run — 10k at easy pace",
      priority: "p3",
      scheduled_date: tomorrow,
      duration_minutes: 60,
      project_id: HEALTH.id,
      tags: ["training"],
    }),
    projects: [MOBILE, HEALTH, HOME],
    open: true,
    onClose: () => {},
  },
};

/** A pale project colour — the cover's bottom scrim is what keeps the white
 *  pill, rail and estimate legible over amber. */
export const CoverPaleProject: Story = {
  args: {
    task: makeTask({
      title: "Book the boiler service",
      priority: "p1",
      scheduled_date: nextWeek,
      duration_minutes: 30,
      project_id: HOME.id,
    }),
    projects: [MOBILE, HEALTH, HOME],
    open: true,
    onClose: () => {},
  },
};

/** No project: the app's own indigo rather than a hole where the banner goes,
 *  and the pill becomes the way to file the task. */
export const NoProjectIcon: Story = {
  args: {
    task: makeTask({
      title: "Something I haven't filed yet",
      priority: "p4",
      scheduled_date: null,
      duration_minutes: null,
      project_id: null,
    }),
    projects: [MOBILE, HEALTH, HOME],
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
      scheduled_date: nextWeek,
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
      scheduled_date: today,
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
      scheduled_date: today,
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
      scheduled_date: twoDaysOut,
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
      scheduled_date: nextWeek,
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
      scheduled_date: twoDaysOut,
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
 * The deadline popover, opened automatically. Common deadlines are one tap
 * ("Same as task date" mirrors the do-date, plus Tomorrow / This weekend /
 * Next week); a native date input remains below for anything else.
 */
export const PickingDeadlineDate: Story = {
  args: {
    task: makeTask({
      title: "Submit tax forms",
      priority: "p2",
      scheduled_date: today,
      tags: ["finance"],
    }),
    open: true,
    onClose: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTitle("Set deadline"));
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
      scheduled_date: today,
      scheduled_time: "09:00",
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
 * of the browser's native top-anchored confirm. Delete now lives in the top-bar
 * overflow menu, so the route there is two clicks.
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
    await userEvent.click(await canvas.findByLabelText("Task menu"));
    await userEvent.click(await canvas.findByText("Delete task"));
    await waitFor(() =>
      expect(canvas.getByText("Delete task?")).toBeInTheDocument()
    );
  },
};

/** The top-bar overflow menu, open. Holds Delete, off the main chrome. */
export const TaskMenuOpen: Story = {
  args: {
    task: makeTask({
      title: "Archive the Q3 board",
      priority: "p3",
      tags: ["ops"],
    }),
    open: true,
    onClose: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByLabelText("Task menu"));
    await waitFor(() =>
      expect(canvas.getByText("Delete task")).toBeInTheDocument()
    );
  },
};

/**
 * A finished task: the completion circle beside the title is filled and the
 * title's Status field agrees, since the circle writes through the same field.
 */
export const CompletedTask: Story = {
  args: {
    task: makeTask({
      title: "Send the invoice",
      priority: "p2",
      status: "done",
      scheduled_date: today,
      tags: ["finance"],
    }),
    open: true,
    onClose: () => {},
  },
};
