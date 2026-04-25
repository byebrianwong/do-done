import type { Task, Project } from "@do-done/shared";

const NOW = new Date();
const TODAY = NOW.toISOString().split("T")[0];
const TOMORROW = (() => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
})();
const YESTERDAY = (() => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
})();

const baseTask: Omit<Task, "id" | "title" | "priority" | "status"> = {
  user_id: "user-1",
  description: null,
  project_id: null,
  due_date: null,
  due_time: null,
  duration_minutes: null,
  recurrence_rule: null,
  calendar_event_id: null,
  tags: [],
  sort_order: 0,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  completed_at: null,
};

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    ...baseTask,
    id: `task-${Math.random().toString(36).slice(2, 9)}`,
    title: "Sample task",
    priority: "p3",
    status: "todo",
    ...overrides,
  } as Task;
}

export const SAMPLE_TASKS: Task[] = [
  makeTask({
    title: "Fix critical login bug",
    priority: "p1",
    status: "todo",
    due_date: TODAY,
    tags: ["urgent", "work"],
  }),
  makeTask({
    title: "Review pull request",
    priority: "p2",
    status: "in_progress",
    due_date: TODAY,
    due_time: "14:00",
    duration_minutes: 60,
    project_id: "proj-1",
  }),
  makeTask({
    title: "Buy groceries for the week",
    priority: "p3",
    status: "inbox",
    tags: ["groceries"],
    project_id: "proj-2",
  }),
  makeTask({
    title: "Team standup",
    priority: "p2",
    status: "todo",
    due_date: TODAY,
    due_time: "09:30",
    duration_minutes: 30,
    recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  }),
  makeTask({
    title: "Schedule dentist appointment",
    priority: "p4",
    status: "inbox",
  }),
  makeTask({
    title: "Pay credit card bill",
    priority: "p1",
    status: "todo",
    due_date: YESTERDAY,
    tags: ["finance"],
  }),
  makeTask({
    title: "Plan weekend trip",
    priority: "p4",
    status: "todo",
    due_date: TOMORROW,
    tags: ["personal"],
  }),
  makeTask({
    title: "Deploy v2 release",
    priority: "p1",
    status: "done",
    completed_at: NOW.toISOString(),
  }),
];

export const SAMPLE_PROJECTS: Project[] = [
  {
    id: "proj-1",
    user_id: "user-1",
    name: "Engineering",
    color: "#6366f1",
    icon: null,
    parent_project_id: null,
    sort_order: 0,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  },
  {
    id: "proj-2",
    user_id: "user-1",
    name: "Personal",
    color: "#22c55e",
    icon: null,
    parent_project_id: null,
    sort_order: 1,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  },
  {
    id: "proj-3",
    user_id: "user-1",
    name: "Design",
    color: "#ec4899",
    icon: null,
    parent_project_id: null,
    sort_order: 2,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  },
];

export function getMonday(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
