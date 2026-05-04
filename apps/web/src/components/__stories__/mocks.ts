import type {
  AppearanceSeed,
  Pet,
  PetEvent,
  PetEventActor,
  PetGoal,
  PetMood,
  Project,
  Task,
} from "@do-done/shared";
import type { PetState } from "@do-done/api-client";

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

// ── Pet mocks ─────────────────────────────────────────

export const SAMPLE_APPEARANCE_SEED: AppearanceSeed = {
  bodyHue: 168, // pastel teal-green — aesthetic E default
  bodyShape: "blob",
  eyeStyle: "dot",
  accessories: [],
};

export function makePet(overrides: Partial<Pet> = {}): Pet {
  return {
    user_id: "user-1",
    name: "Pip",
    birthed_at: NOW.toISOString(),
    hunger_at_last_seen: 80,
    happiness_at_last_seen: 80,
    energy_at_last_seen: 80,
    last_seen_at: NOW.toISOString(),
    appearance_seed: { ...SAMPLE_APPEARANCE_SEED },
    level: 4,
    xp: 420,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

export function makePetEvent(
  overrides: Partial<PetEvent> & { minutesAgo?: number } = {}
): PetEvent {
  const minutesAgo = overrides.minutesAgo ?? 5;
  const created = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  const { minutesAgo: _ignored, ...rest } = overrides;
  return {
    id: `pet-event-${Math.random().toString(36).slice(2, 9)}`,
    user_id: "user-1",
    event_type: "fed",
    task_id: null,
    actor: "user",
    delta_hunger: 15,
    delta_happiness: 10,
    delta_energy: 0,
    delta_xp: 15,
    narrative: null,
    created_at: created,
    ...rest,
  };
}

export function makePetGoal(overrides: Partial<PetGoal> = {}): PetGoal {
  return {
    id: `pet-goal-${Math.random().toString(36).slice(2, 9)}`,
    user_id: "user-1",
    description: "Pip wants to learn something new this week",
    proposed_by: "claude",
    status: "open",
    task_id: null,
    created_at: NOW.toISOString(),
    completed_at: null,
    ...overrides,
  };
}

export interface MakePetStateOverrides {
  pet?: Partial<Pet>;
  current_stats?: Partial<PetState["current_stats"]>;
  mood?: PetMood;
  goals?: PetGoal[];
  recent_events?: PetEvent[];
}

export function makePetState(
  overrides: MakePetStateOverrides = {}
): PetState {
  const pet = makePet(overrides.pet);
  const current_stats = {
    hunger: 75,
    happiness: 80,
    energy: 65,
    ...overrides.current_stats,
  };
  return {
    pet,
    current_stats,
    mood: overrides.mood ?? "happy",
    goals: overrides.goals ?? [],
    recent_events: overrides.recent_events ?? SAMPLE_PET_EVENTS,
  };
}

export const SAMPLE_PET_EVENTS: PetEvent[] = [
  makePetEvent({
    minutesAgo: 14,
    actor: "user" as PetEventActor,
    event_type: "fed",
    delta_hunger: 20,
    delta_happiness: 15,
    delta_energy: 0,
    delta_xp: 50,
    narrative: "Design system audit",
  }),
  makePetEvent({
    minutesAgo: 60,
    actor: "claude" as PetEventActor,
    event_type: "fed",
    delta_hunger: 8,
    delta_happiness: 0,
    delta_energy: 8,
    delta_xp: 5,
    narrative: "Email follow-ups",
  }),
  makePetEvent({
    minutesAgo: 180,
    actor: "user" as PetEventActor,
    event_type: "fed",
    delta_hunger: 15,
    delta_happiness: 10,
    delta_energy: 0,
    delta_xp: 15,
    narrative: "Update Storybook stories",
  }),
];
