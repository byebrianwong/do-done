import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, waitFor, within } from "storybook/test";
import type { Task } from "@do-done/shared";

import { AppShell } from "./app-shell";
import { UndoToastProvider } from "./undo-toast";
import { CommandPalette } from "./command-palette";
import { TaskForm } from "./task-form";
import { TaskDisplayView } from "./task-display-view";
import { TodayView } from "./today-view";
import { UpcomingView } from "./upcoming-view";
import { AllTasksView } from "./all-tasks-view";
import { WeekView } from "./week-view";
import { InboxFilterToggle } from "./inbox-filter-toggle";
import { ProjectForm } from "./project-form";
import {
  getMonday,
  makeTask,
  SAMPLE_PROJECTS,
  SAMPLE_TASKS,
} from "./__stories__/mocks";

/**
 * Pages — full-route compositions.
 *
 * Each story wraps real page content in the real `AppShell` (sidebar + mobile
 * top bar) and `UndoToastProvider`, mirroring `app/(app)/layout.tsx`. This is
 * the "templates / pages" tier of the system: a change to a token or a leaf
 * component (TaskItem, the Display menu, a project chip) ripples through every
 * page here at once, so these snapshots are where cross-cutting blast radius
 * shows up.
 *
 * Determinism notes:
 *  - The Pip side-panel column is `xl:block` (hidden < 1280px) and self-hides
 *    when its data fetch fails (the Storybook env has no Supabase). At the
 *    default snapshot width it never renders, keeping these shots stable. Pip
 *    has its own dedicated stories under "Pet/*".
 *  - Persisted Display configs are cleared per render so Sort/Group/Filter
 *    always start from defaults.
 */

const DISPLAY_KEYS = [
  "dodone.display.inbox",
  "dodone.display.all",
  "dodone.display.today",
  "dodone.display.upcoming",
  "dodone.display.completed",
];

function clearDisplayConfig() {
  if (typeof window === "undefined") return;
  for (const k of DISPLAY_KEYS) window.localStorage.removeItem(k);
}

function PageShell({
  children,
  withCommandPalette = false,
}: {
  children: React.ReactNode;
  withCommandPalette?: boolean;
}) {
  return (
    <UndoToastProvider>
      <AppShell projects={SAMPLE_PROJECTS} userEmail="ada@dodone.app">
        {children}
      </AppShell>
      {withCommandPalette ? (
        <CommandPalette projects={SAMPLE_PROJECTS} />
      ) : null}
    </UndoToastProvider>
  );
}

const meta: Meta = {
  title: "Pages",
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true },
  },
  decorators: [
    (Story) => {
      clearDisplayConfig();
      return <Story />;
    },
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Fixtures ───────────────────────────────────────────────────────────

/** Local YYYY-MM-DD, `offset` days from today. */
function ymd(offset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split("T")[0];
}

const INBOX_TASKS: Task[] = [
  makeTask({ title: "Reply to the design feedback thread", priority: "p2" }),
  makeTask({
    title: "Draft Q3 planning doc",
    priority: "p3",
    duration_minutes: 90,
    tags: ["planning"],
  }),
  makeTask({
    title: "Renew domain before it lapses",
    priority: "p1",
    due_date: ymd(2),
  }),
  makeTask({
    title: "Look into noise-cancelling headphones",
    priority: "p4",
  }),
];

const UPCOMING_TASKS: Task[] = [
  makeTask({
    title: "Team standup",
    priority: "p2",
    when_date: ymd(0),
    when_time: "09:30",
    duration_minutes: 30,
    project_id: "proj-1",
    recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  }),
  makeTask({
    title: "Submit expense report",
    priority: "p3",
    when_date: ymd(1),
    project_id: "proj-2",
  }),
  makeTask({
    title: "Design review",
    priority: "p2",
    when_date: ymd(2),
    when_time: "14:00",
    duration_minutes: 60,
    project_id: "proj-3",
  }),
  makeTask({
    title: "Ship the calendar fix",
    priority: "p1",
    when_date: ymd(3),
    duration_minutes: 120,
    project_id: "proj-1",
  }),
  makeTask({
    title: "Call the dentist",
    priority: "p3",
    status: "inbox",
    when_date: ymd(4),
  }),
];

const COMPLETED_TASKS: Task[] = [
  makeTask({
    title: "Deploy v2 release",
    priority: "p1",
    status: "done",
    completed_at: `${ymd(-1)}T15:00:00.000Z`,
    project_id: "proj-1",
    tags: ["work"],
  }),
  makeTask({
    title: "Buy groceries for the week",
    priority: "p3",
    status: "done",
    completed_at: `${ymd(-2)}T18:45:00.000Z`,
    project_id: "proj-2",
    tags: ["groceries"],
  }),
  makeTask({
    title: "Pay credit card bill",
    priority: "p1",
    status: "done",
    completed_at: `${ymd(-3)}T09:00:00.000Z`,
    tags: ["finance"],
  }),
  makeTask({
    title: "Write release notes",
    priority: "p3",
    status: "done",
    completed_at: `${ymd(-3)}T11:30:00.000Z`,
    project_id: "proj-1",
  }),
];

const monday = new Date(getMonday());
function weekDay(days: number): string {
  const d = new Date(monday);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
const CALENDAR_TASKS: Task[] = [
  makeTask({
    title: "Team standup",
    priority: "p2",
    due_date: weekDay(0),
    due_time: "09:30",
    duration_minutes: 30,
    project_id: "proj-1",
  }),
  makeTask({
    title: "Deep work: refactor auth",
    priority: "p1",
    due_date: weekDay(1),
    due_time: "10:00",
    duration_minutes: 120,
    project_id: "proj-1",
  }),
  makeTask({
    title: "Lunch with Alex",
    priority: "p3",
    due_date: weekDay(2),
    due_time: "12:30",
    duration_minutes: 60,
    project_id: "proj-2",
  }),
  makeTask({
    title: "Design review",
    priority: "p2",
    due_date: weekDay(3),
    due_time: "14:00",
    duration_minutes: 60,
    project_id: "proj-3",
  }),
  makeTask({
    title: "Weekly retro",
    priority: "p3",
    due_date: weekDay(4),
    due_time: "16:00",
    duration_minutes: 60,
    project_id: "proj-1",
    recurrence_rule: "FREQ=WEEKLY;BYDAY=FR",
  }),
];

const PROJECTS_WITH_COUNTS = [
  { ...SAMPLE_PROJECTS[0], open_count: 7, task_count: 24 },
  { ...SAMPLE_PROJECTS[1], open_count: 3, task_count: 11 },
  { ...SAMPLE_PROJECTS[2], open_count: 0, task_count: 6 },
];

// ── Page content (mirrors each route's JSX, minus the server fetch) ─────

function InboxContent({ tasks }: { tasks: Task[] }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Inbox
      </h1>
      <TaskForm defaultStatus="inbox" />
      <div className="mt-4">
        <TaskDisplayView
          viewKey="inbox"
          tasks={tasks}
          projects={SAMPLE_PROJECTS}
          emptyText="No tasks in your inbox. Add one above to get started."
        />
      </div>
    </div>
  );
}

function ProjectsContent() {
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Projects
        </h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600"
        >
          + New project
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PROJECTS_WITH_COUNTS.map((p) => (
          <div
            key={p.id}
            className="group rounded-xl border border-neutral-200 bg-white p-4 transition-all hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {p.icon ? `${p.icon} ` : ""}
                  {p.name}
                </h2>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
              <span>
                <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                  {p.open_count}
                </span>{" "}
                open
              </span>
              <span className="h-1 w-1 rounded-full bg-neutral-300" />
              <span>{p.task_count} total</span>
            </div>
          </div>
        ))}
      </div>
      {creating ? <ProjectForm onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

// A static stand-in for the real <CalendarSection/> (whose only behavior is a
// fetch-backed "Sync now"). Keeps the Settings page snapshot self-contained.
function CalendarCard({ connected }: { connected: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
            Google Calendar
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            Sync tasks with start times and durations as calendar timeblocks.
          </p>
          {connected ? (
            <p className="mt-2 text-xs text-neutral-400">
              Last synced: {ymd(0)} 08:15
            </p>
          ) : null}
        </div>
        {connected ? (
          <div className="flex shrink-0 gap-2">
            <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
              Sync now
            </button>
            <button className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950">
              Disconnect
            </button>
          </div>
        ) : (
          <span className="shrink-0 rounded-lg bg-indigo-500 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-600">
            Connect
          </span>
        )}
      </div>
      {connected ? (
        <div className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-950/50 dark:text-green-400">
          ✓ Connected to Google Calendar
        </div>
      ) : null}
    </div>
  );
}

function SettingsContent({ connected }: { connected: boolean }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Settings
      </h1>
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Account
        </h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            <span className="text-neutral-400">Email: </span>
            ada@dodone.app
          </p>
        </div>
      </section>
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Integrations
        </h2>
        <CalendarCard connected={connected} />
      </section>
    </div>
  );
}

// ── Stories ────────────────────────────────────────────────────────────

export const Inbox: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } } },
  render: () => (
    <PageShell>
      <InboxContent tasks={INBOX_TASKS} />
    </PageShell>
  ),
};

export const InboxEmpty: Story = {
  name: "Inbox (empty)",
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } } },
  render: () => (
    <PageShell>
      <InboxContent tasks={[]} />
    </PageShell>
  ),
};

export const Today: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/today" } } },
  render: () => (
    <PageShell>
      <TodayView allTasks={SAMPLE_TASKS} projects={SAMPLE_PROJECTS} />
    </PageShell>
  ),
};

export const Upcoming: Story = {
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/upcoming" } },
  },
  render: () => (
    <PageShell>
      <UpcomingView
        allTasks={UPCOMING_TASKS}
        projects={SAMPLE_PROJECTS}
        beforeContent={
          <div className="mb-4">
            <InboxFilterToggle count={1} />
          </div>
        }
      />
    </PageShell>
  ),
};

export const Calendar: Story = {
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/calendar" } },
  },
  render: () => (
    <PageShell>
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Calendar
        </h1>
        <WeekView
          weekStart={monday.toISOString()}
          tasks={CALENDAR_TASKS}
          projects={SAMPLE_PROJECTS}
        />
      </div>
    </PageShell>
  ),
};

export const AllTasks: Story = {
  name: "All tasks",
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/all" } } },
  render: () => (
    <PageShell>
      <AllTasksView tasks={SAMPLE_TASKS} projects={SAMPLE_PROJECTS} />
    </PageShell>
  ),
};

export const Completed: Story = {
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/completed" } },
  },
  render: () => (
    <PageShell>
      <div className="mx-auto max-w-3xl">
        <TaskDisplayView
          viewKey="completed"
          title="Completed"
          subtitle="Click a task to reopen it."
          tasks={COMPLETED_TASKS}
          projects={SAMPLE_PROJECTS}
          emptyText="Nothing here yet — complete a task and it’ll land here."
        />
      </div>
    </PageShell>
  ),
};

export const Projects: Story = {
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/projects" } },
  },
  render: () => (
    <PageShell>
      <ProjectsContent />
    </PageShell>
  ),
};

export const ProjectsNewModal: Story = {
  name: "Projects (new-project modal)",
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/projects" } },
  },
  render: () => (
    <PageShell>
      <ProjectsContent />
    </PageShell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /new project/i }));
    await waitFor(() => canvas.getByText("New project"));
  },
};

export const SettingsConnected: Story = {
  name: "Settings (calendar connected)",
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/settings" } },
  },
  render: () => (
    <PageShell>
      <SettingsContent connected />
    </PageShell>
  ),
};

export const SettingsDisconnected: Story = {
  name: "Settings (not connected)",
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/settings" } },
  },
  render: () => (
    <PageShell>
      <SettingsContent connected={false} />
    </PageShell>
  ),
};

// Overlay blast radius: the command palette dimming a real page beneath it.
export const CommandPaletteOpen: Story = {
  name: "Command palette (over Today)",
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/today" } } },
  render: () => (
    <PageShell withCommandPalette>
      <TodayView allTasks={SAMPLE_TASKS} projects={SAMPLE_PROJECTS} />
    </PageShell>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const canvas = within(canvasElement);
    await waitFor(() =>
      canvas.getByPlaceholderText(/search tasks, navigate/i)
    );
  },
};

// Responsive blast radius: at <768px the docked sidebar collapses into the
// sticky top bar. Captured at a phone width in Chromatic.
export const InboxMobile: Story = {
  name: "Inbox (mobile)",
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
    chromatic: { viewports: [390] },
  },
  render: () => (
    <PageShell>
      <InboxContent tasks={INBOX_TASKS} />
    </PageShell>
  ),
};
