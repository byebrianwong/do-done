import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { waitFor, within } from "storybook/test";
import { TaskItem } from "./task-item";
import { BulkActionBar } from "./bulk-action-bar";
import { UndoToastProvider } from "./undo-toast";
import { TaskSelectionProvider } from "@/lib/task-selection";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

const meta: Meta<typeof TaskItem> = {
  title: "Components/TaskItem",
  component: TaskItem,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/inbox" } },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl bg-white p-4 dark:bg-neutral-900">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const today = new Date().toISOString().split("T")[0];
const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
})();
const yesterday = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
})();
const yesterdayAt = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(16, 20, 0, 0);
  return d.toISOString();
})();
const nextWeek = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  return d.toISOString().split("T")[0];
})();

export const Default: Story = {
  args: { task: makeTask({ title: "Review pull request", priority: "p3" }) },
};

export const UrlInTitle: Story = {
  name: "URL in title (clickable link)",
  // A raw link typed into the title renders as a clickable link in place, while
  // the rest of the row still opens the editor on click.
  args: {
    task: makeTask({
      title: "Buy dog food https://www.example.com/",
      priority: "p3",
    }),
  },
};

export const HighPriority: Story = {
  args: {
    task: makeTask({
      title: "Fix critical login bug",
      priority: "p1",
      tags: ["urgent", "work"],
    }),
  },
};

export const Overdue: Story = {
  args: {
    task: makeTask({
      title: "Submit quarterly report",
      priority: "p2",
      deadline_date: yesterday,
    }),
  },
};

export const DeadlineToday: Story = {
  args: {
    task: makeTask({
      title: "Team standup",
      priority: "p2",
      deadline_date: today,
      deadline_time: "09:30",
      duration_minutes: 30,
    }),
  },
};

export const Recurring: Story = {
  args: {
    task: makeTask({
      title: "Weekly retro",
      priority: "p3",
      deadline_date: today,
      deadline_time: "16:00",
      duration_minutes: 60,
      recurrence_rule: "FREQ=WEEKLY;BYDAY=FR",
    }),
  },
};

export const Weekdays: Story = {
  args: {
    task: makeTask({
      title: "Daily standup",
      priority: "p2",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    }),
  },
};

export const Completed: Story = {
  // A finished task shows WHEN it was completed (a neutral chip), not its
  // original scheduled-/deadline-date. Its deadline was yesterday — pre-fix the row read
  // "Overdue" (unhelpful for done work); now it reads "Yesterday".
  args: {
    task: makeTask({
      title: "Deploy v2 release",
      priority: "p1",
      status: "done",
      deadline_date: yesterday,
      completed_at: yesterdayAt,
    }),
  },
};

export const ScheduleableTask: Story = {
  name: "Has duration but no time (shows Schedule button on hover)",
  args: {
    task: makeTask({
      title: "Deep work session",
      priority: "p2",
      duration_minutes: 90,
    }),
  },
};

export const ScheduledWithTime: Story = {
  name: "Scheduled date + time (with time of day)",
  args: {
    task: makeTask({
      title: "Deep work session",
      priority: "p2",
      scheduled_date: tomorrow,
      scheduled_time: "15:00",
      duration_minutes: 90,
    }),
  },
};

export const Future: Story = {
  args: {
    task: makeTask({
      title: "Plan weekend trip",
      priority: "p4",
      deadline_date: nextWeek,
      tags: ["personal"],
    }),
  },
};

export const WithProject: Story = {
  args: {
    task: makeTask({
      title: "Refactor auth module",
      priority: "p2",
      project_id: "proj-1",
    }),
    projects: SAMPLE_PROJECTS,
  },
};

// ── Subtask (references its parent) ────────────────────────────────────

export const Subtask: Story = {
  name: "Subtask (references parent)",
  // A subtask row carries a "↳ parent" breadcrumb linking to the parent task,
  // so it reads as a subtask anywhere it appears — not just under its parent.
  args: {
    task: makeTask({
      title: "Draft the onboarding email",
      priority: "p3",
      parent_task_id: "parent-1",
      depth: 1,
      project_id: "proj-1",
    }),
    parentTask: { id: "parent-1", title: "Launch the new signup flow" },
    projects: SAMPLE_PROJECTS,
  },
};

export const SubtaskInList: Story = {
  name: "Subtask (parent + children in a list)",
  render: () => (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      <TaskItem
        task={makeTask({
          id: "parent-1",
          title: "Launch the new signup flow",
          priority: "p1",
          project_id: "proj-1",
        })}
        projects={SAMPLE_PROJECTS}
      />
      <TaskItem
        task={makeTask({
          title: "Draft the onboarding email",
          priority: "p3",
          parent_task_id: "parent-1",
          depth: 1,
          project_id: "proj-1",
        })}
        parentTask={{ id: "parent-1", title: "Launch the new signup flow" }}
        projects={SAMPLE_PROJECTS}
      />
      <TaskItem
        task={makeTask({
          title: "Wire up the welcome checklist",
          priority: "p2",
          status: "in_progress",
          parent_task_id: "parent-1",
          depth: 1,
          project_id: "proj-1",
          scheduled_date: tomorrow,
        })}
        parentTask={{ id: "parent-1", title: "Launch the new signup flow" }}
        projects={SAMPLE_PROJECTS}
      />
    </div>
  ),
};

// ── Status edge cases ──────────────────────────────────────────────────

export const InboxStatus: Story = {
  name: "Inbox (no status badge)",
  args: { task: makeTask({ title: "Capture a fleeting idea", status: "inbox" }) },
};

export const InProgress: Story = {
  args: {
    task: makeTask({
      title: "Migrate the legacy importer",
      priority: "p2",
      status: "in_progress",
      project_id: "proj-1",
    }),
    projects: SAMPLE_PROJECTS,
  },
};

export const NextUp: Story = {
  args: {
    task: makeTask({
      title: "Reply to the recruiter",
      priority: "p3",
      status: "next",
    }),
  },
};

export const Cancelled: Story = {
  args: {
    task: makeTask({
      title: "Attend the offsite (cancelled)",
      priority: "p4",
      status: "cancelled",
    }),
  },
};

// ── Scheduling edge cases ──────────────────────────────────────────────

export const Unscheduled: Story = {
  name: "Unscheduled (no date)",
  args: {
    task: makeTask({
      title: "Read that systems-design book",
      priority: "p4",
    }),
  },
};

export const DoDateWithDeadline: Story = {
  name: "Do-date + separate hard deadline",
  args: {
    task: makeTask({
      title: "Finish the grant application",
      priority: "p1",
      scheduled_date: tomorrow,
      deadline_date: nextWeek,
      duration_minutes: 120,
    }),
  },
};

// ── Content overflow edge cases ────────────────────────────────────────

export const LongTitle: Story = {
  args: {
    task: makeTask({
      title:
        "Investigate why the nightly sync job intermittently drops a handful of recurring tasks when the timezone offset changes during daylight-saving transitions",
      priority: "p2",
      deadline_date: today,
    }),
  },
};

/**
 * The case that made the row's alignment visible: a title long enough to wrap,
 * carrying the full set of metadata. Every piece of furniture — the completion
 * circle, the priority bars, each chip, the date and the edit button — sits on
 * the title's FIRST line, so the row still reads along the same line as its
 * single-line neighbours instead of floating into the gap between two.
 */
export const WrappedTitleWithMetadata: Story = {
  name: "Long title with metadata (first-line alignment)",
  args: {
    task: makeTask({
      title: "Finish godaddy porkbun domain transfer for paperandmilk.com",
      priority: "p3",
      status: "next",
      project_id: "proj-2",
      duration_minutes: 30,
      scheduled_date: today,
    }),
    projects: SAMPLE_PROJECTS,
  },
};

export const ManyTags: Story = {
  args: {
    task: makeTask({
      title: "Plan the launch",
      priority: "p2",
      tags: ["launch", "marketing", "urgent", "q3", "cross-team", "review"],
      project_id: "proj-3",
      duration_minutes: 45,
    }),
    projects: SAMPLE_PROJECTS,
  },
};

// ── Narrow / mobile: title gets its own row, metadata wraps beneath ────────

export const MobileTwoRow: Story = {
  name: "Mobile (narrow — two-row layout)",
  // The two-row layout is driven by the row's own width (an `@container`
  // query), not the viewport — so a fixed narrow container reproduces it at
  // any snapshot viewport, no mobile-viewport emulation needed.
  decorators: [
    (Story) => (
      <div className="mx-auto w-[380px] divide-y divide-neutral-100 dark:divide-neutral-800">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <>
      <TaskItem
        task={makeTask({
          title:
            "Investigate why the nightly sync job intermittently drops recurring tasks",
          priority: "p1",
          deadline_date: today,
          deadline_time: "09:30",
          duration_minutes: 60,
          tags: ["urgent", "backend"],
          project_id: "proj-1",
        })}
        projects={SAMPLE_PROJECTS}
      />
      <TaskItem
        task={makeTask({
          title: "Review pull request",
          priority: "p2",
          status: "in_progress",
          scheduled_date: tomorrow,
          scheduled_time: "15:00",
          project_id: "proj-2",
          duration_minutes: 30,
        })}
        projects={SAMPLE_PROJECTS}
      />
      <TaskItem
        task={makeTask({ title: "Buy groceries", priority: "p3" })}
      />
      <TaskItem
        task={makeTask({
          title: "Finish the grant application",
          priority: "p1",
          scheduled_date: tomorrow,
          deadline_date: nextWeek,
          duration_minutes: 120,
        })}
      />
    </>
  ),
};

// ── Multi-select: rows inside the selection provider + the floating bar ────

const SELECTABLE = [
  makeTask({ id: "s1", title: "Fix critical login bug", priority: "p1", deadline_date: yesterday }),
  makeTask({ id: "s2", title: "Review pull request", priority: "p2", project_id: "proj-1", duration_minutes: 60 }),
  makeTask({ id: "s3", title: "Team standup", priority: "p2", deadline_date: today, deadline_time: "09:30" }),
  makeTask({ id: "s4", title: "Buy groceries", priority: "p3", scheduled_date: tomorrow }),
  makeTask({ id: "s5", title: "Plan the launch", priority: "p2", tags: ["q3"], project_id: "proj-3" }),
];

/**
 * A live list wrapped in the selection provider with the floating bar mounted,
 * the way the real app shell composes them. The play function ⌘-clicks the
 * first row and Shift-clicks the third to select a range — so the snapshot
 * shows the selected-row highlight and the bar.
 */
export const MultiSelectRange: Story = {
  name: "Multi-select (⌘-click + Shift-click range)",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <UndoToastProvider>
        <TaskSelectionProvider>
          <div className="mx-auto min-h-[420px] max-w-2xl p-4">
            <Story />
          </div>
          <BulkActionBar projects={SAMPLE_PROJECTS} />
        </TaskSelectionProvider>
      </UndoToastProvider>
    ),
  ],
  render: () => (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {SELECTABLE.map((t) => (
        <TaskItem key={t.id} task={t} projects={SAMPLE_PROJECTS} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const click = (id: string, mods: MouseEventInit) =>
      canvasElement
        .querySelector<HTMLElement>(`[data-task-row="${id}"]`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, ...mods }));
    // ⌘-click the first row (anchor), then Shift-click the third to extend the
    // range. Dispatching the modifier flag directly is more reliable than
    // driving held keys through the pointer.
    click("s1", { metaKey: true });
    click("s3", { shiftKey: true });
    await waitFor(() =>
      within(canvasElement.ownerDocument.body).getByText("3 selected")
    );
  },
};

// ── Gallery: a representative row stack (single change → many rows shift) ──

export const Gallery: Story = {
  name: "Gallery (mixed rows)",
  args: { task: makeTask({ title: "Fix critical login bug", priority: "p1", deadline_date: yesterday }) },
  render: () => (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      <TaskItem
        task={makeTask({ title: "Fix critical login bug", priority: "p1", deadline_date: yesterday, tags: ["urgent"] })}
      />
      <TaskItem
        task={makeTask({
          title: "Review pull request",
          priority: "p2",
          status: "in_progress",
          deadline_date: today,
          deadline_time: "14:00",
          duration_minutes: 60,
          project_id: "proj-1",
        })}
        projects={SAMPLE_PROJECTS}
      />
      <TaskItem
        task={makeTask({
          title: "Team standup",
          priority: "p2",
          deadline_date: today,
          deadline_time: "09:30",
          duration_minutes: 30,
          recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        })}
      />
      <TaskItem
        task={makeTask({ title: "Buy groceries", priority: "p3", scheduled_date: tomorrow, scheduled_time: "15:00", project_id: "proj-2" })}
        projects={SAMPLE_PROJECTS}
      />
      <TaskItem task={makeTask({ title: "Schedule dentist appointment", priority: "p4", status: "inbox" })} />
      <TaskItem task={makeTask({ title: "Deploy v2 release", priority: "p1", status: "done" })} />
    </div>
  ),
};
