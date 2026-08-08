import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { WeekView } from "./week-view";
import { makeTask, SAMPLE_PROJECTS, getMonday } from "./__stories__/mocks";
import { todayLocalISO, type Task } from "@do-done/shared";

const meta: Meta<typeof WeekView> = {
  title: "Components/WeekView",
  component: WeekView,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/calendar" } },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-7xl p-6">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const monday = new Date(getMonday());

function dayOffset(days: number): string {
  const d = new Date(monday);
  d.setDate(d.getDate() + days);
  return todayLocalISO(d);
}

const busyWeek: Task[] = [
  makeTask({
    title: "Team standup",
    priority: "p2",
    deadline_date: dayOffset(0),
    deadline_time: "09:30",
    duration_minutes: 30,
    project_id: "proj-1",
  }),
  makeTask({
    title: "Design review",
    priority: "p2",
    deadline_date: dayOffset(0),
    deadline_time: "14:00",
    duration_minutes: 60,
    project_id: "proj-3",
  }),
  makeTask({
    title: "Deep work: refactor auth",
    priority: "p1",
    deadline_date: dayOffset(1),
    deadline_time: "10:00",
    duration_minutes: 120,
    project_id: "proj-1",
  }),
  makeTask({
    title: "1:1 with manager",
    priority: "p2",
    deadline_date: dayOffset(1),
    deadline_time: "15:00",
    duration_minutes: 30,
  }),
  makeTask({
    title: "Lunch with Alex",
    priority: "p3",
    deadline_date: dayOffset(2),
    deadline_time: "12:30",
    duration_minutes: 60,
    project_id: "proj-2",
  }),
  makeTask({
    title: "All-hands",
    priority: "p3",
    deadline_date: dayOffset(3),
    deadline_time: "11:00",
    duration_minutes: 60,
    project_id: "proj-1",
  }),
  makeTask({
    title: "Weekly retro",
    priority: "p3",
    deadline_date: dayOffset(4),
    deadline_time: "16:00",
    duration_minutes: 60,
    project_id: "proj-1",
    recurrence_rule: "FREQ=WEEKLY;BYDAY=FR",
  }),
  makeTask({
    title: "Plan next sprint",
    priority: "p1",
    deadline_date: dayOffset(0),
    deadline_time: "16:30",
    duration_minutes: 90,
    project_id: "proj-1",
  }),
];

export const BusyWeek: Story = {
  args: {
    weekStart: todayLocalISO(monday),
    tasks: busyWeek,
    projects: SAMPLE_PROJECTS,
  },
};

export const Empty: Story = {
  args: {
    weekStart: todayLocalISO(monday),
    tasks: [],
    projects: SAMPLE_PROJECTS,
  },
};

// All-day tasks (no deadline_time/duration) render as in-flow chips in the day
// header strip. Titles of varying length across days exercise the equal-column
// layout and text wrapping.
export const AllDayHeavy: Story = {
  args: {
    weekStart: todayLocalISO(monday),
    tasks: [
      makeTask({
        title: "Finish quarterly planning doc and circulate for review",
        priority: "p1",
        scheduled_date: dayOffset(0),
        project_id: "proj-1",
      }),
      makeTask({ title: "Email", priority: "p3", scheduled_date: dayOffset(0) }),
      makeTask({
        title: "Renew passport",
        priority: "p2",
        scheduled_date: dayOffset(1),
        project_id: "proj-2",
      }),
      makeTask({
        title: "Reorganize the entire garage this weekend",
        priority: "p3",
        scheduled_date: dayOffset(2),
      }),
      makeTask({
        title: "Pay rent",
        priority: "p1",
        scheduled_date: dayOffset(3),
        project_id: "proj-3",
      }),
      makeTask({
        title: "Call dentist",
        priority: "p2",
        scheduled_date: dayOffset(4),
      }),
      makeTask({
        title: "Weekly review",
        priority: "p2",
        scheduled_date: dayOffset(4),
        project_id: "proj-1",
      }),
    ],
    projects: SAMPLE_PROJECTS,
  },
};

// The all-day band is one row across the week, so a day stacked with chips
// must not push its own hour grid down. Three identical 9:00 standups sit
// under wildly different chip counts: they have to land on the same line as
// each other and as the 9 AM label. Before the band was shared they didn't —
// Thursday's rendered four hours low.
export const AllDayBandAlignment: Story = {
  name: "All-day band (uneven chips, aligned hour grids)",
  args: {
    weekStart: todayLocalISO(monday),
    tasks: [
      ...["Renew passport", "Email inbox", "Pay rent", "Call dentist", "Book flights", "Weekly review"].map(
        (title, i) =>
          makeTask({
            title,
            priority: "p3",
            scheduled_date: dayOffset(3),
            project_id: i % 2 ? "proj-1" : "proj-2",
          })
      ),
      makeTask({
        title: "Groceries",
        priority: "p3",
        scheduled_date: dayOffset(4),
      }),
      makeTask({
        title: "Water plants",
        priority: "p3",
        scheduled_date: dayOffset(4),
      }),
      makeTask({
        title: "Tidy desk",
        priority: "p3",
        scheduled_date: dayOffset(5),
      }),
      // Identical times, three different chip counts above them.
      ...[0, 3, 4].map((day) =>
        makeTask({
          title: "Standup",
          priority: "p2",
          deadline_date: dayOffset(day),
          deadline_time: "09:00",
          duration_minutes: 30,
          project_id: "proj-1",
        })
      ),
    ],
    projects: SAMPLE_PROJECTS,
  },
};

// Both chip kinds — the all-day chip and the timed block — carry links, and
// both stay draggable: the link only follows on a click, never on a drop.
export const UrlInTitle: Story = {
  args: {
    weekStart: todayLocalISO(monday),
    tasks: [
      makeTask({
        title: "https://example.com/billing",
        priority: "p1",
        scheduled_date: dayOffset(1),
      }),
      makeTask({
        title: "Read https://example.com/rfc/42",
        priority: "p2",
        deadline_date: dayOffset(2),
        deadline_time: "10:00",
        duration_minutes: 90,
        project_id: "proj-1",
      }),
    ],
    projects: SAMPLE_PROJECTS,
  },
};

export const SparseTasks: Story = {
  args: {
    weekStart: todayLocalISO(monday),
    tasks: [
      makeTask({
        title: "Doctor appointment",
        priority: "p2",
        deadline_date: dayOffset(2),
        deadline_time: "10:00",
        duration_minutes: 30,
      }),
      makeTask({
        title: "Workout",
        priority: "p3",
        deadline_date: dayOffset(4),
        deadline_time: "07:00",
        duration_minutes: 45,
      }),
    ],
    projects: SAMPLE_PROJECTS,
  },
};

export const CompletedTasks: Story = {
  name: "Completed (rendered with reduced opacity)",
  args: {
    weekStart: todayLocalISO(monday),
    tasks: [
      makeTask({
        title: "Morning workout",
        priority: "p3",
        status: "done",
        deadline_date: dayOffset(0),
        deadline_time: "07:00",
        duration_minutes: 45,
      }),
      makeTask({
        title: "Standup",
        priority: "p2",
        status: "done",
        deadline_date: dayOffset(0),
        deadline_time: "09:30",
        duration_minutes: 30,
      }),
      makeTask({
        title: "Deep work block",
        priority: "p1",
        status: "not_started",
        deadline_date: dayOffset(0),
        deadline_time: "10:30",
        duration_minutes: 120,
      }),
    ],
    projects: SAMPLE_PROJECTS,
  },
};
