import type {
  AppearanceSeed,
  Pet,
  PetEvent,
  PetEventActor,
  PetGoal,
  PetMood,
  Project,
  Task,
  TaskAttachment,
} from "@do-done/shared";
import type { AttachmentsApi, PetState } from "@do-done/api-client";

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
  scheduled_date: null,
  scheduled_time: null,
  deadline_date: null,
  deadline_time: null,
  duration_minutes: null,
  recurrence_rule: null,
  calendar_event_id: null,
  tags: [],
  parent_task_id: null,
  depth: 0,
  sort_order: 0,
  focus_override: null,
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
    status: "not_started",
    ...overrides,
  } as Task;
}

export const SAMPLE_TASKS: Task[] = [
  makeTask({
    title: "Fix critical login bug",
    priority: "p1",
    status: "not_started",
    deadline_date: TODAY,
    tags: ["urgent", "work"],
  }),
  makeTask({
    title: "Review pull request",
    priority: "p2",
    status: "in_progress",
    deadline_date: TODAY,
    deadline_time: "14:00",
    duration_minutes: 60,
    project_id: "proj-1",
  }),
  makeTask({
    title: "Buy groceries for the week",
    priority: "p3",
    status: "inbox",
    scheduled_date: TOMORROW,
    scheduled_time: "15:00",
    duration_minutes: 30,
    tags: ["groceries"],
    project_id: "proj-2",
  }),
  makeTask({
    title: "Team standup",
    priority: "p2",
    status: "not_started",
    deadline_date: TODAY,
    deadline_time: "09:30",
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
    status: "not_started",
    deadline_date: YESTERDAY,
    tags: ["finance"],
  }),
  makeTask({
    title: "Plan weekend trip",
    priority: "p4",
    status: "not_started",
    deadline_date: TOMORROW,
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

// ── Attachments ────────────────────────────────────────────

export function makeAttachment(
  overrides: Partial<TaskAttachment> = {}
): TaskAttachment {
  return {
    id: `att-${Math.random().toString(36).slice(2, 9)}`,
    task_id: "task-1",
    user_id: "user-1",
    storage_path: "user-1/task-1/abc.png",
    file_name: "screenshot.png",
    mime_type: "image/png",
    size_bytes: 184_320,
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

/** A 4×3 gradient, inlined so stories and tests need no network. */
export const SAMPLE_IMAGE_DATA_URL =
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#a5b4fc"/></linearGradient></defs><rect width="480" height="300" fill="url(#g)"/><text x="50%" y="52%" text-anchor="middle" font-family="Inter,sans-serif" font-size="26" fill="white">screenshot.png</text></svg>`
  );

/**
 * A one-second silent WAV, inline.
 *
 * Real enough for the browser to load, report a duration for, and enable its
 * transport on — which is the whole of what the audio card's story needs to
 * show. Built rather than checked in as a binary: a 44-byte header plus zeroed
 * samples is smaller written out than committed.
 */
export const SAMPLE_AUDIO_DATA_URL = (() => {
  const sampleRate = 8000;
  const samples = sampleRate; // one second, 8-bit mono
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples, true);
  // 8-bit PCM is unsigned, so silence is 128 rather than 0.
  bytes.fill(128, 44);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
})();

export const SAMPLE_MARKDOWN = `# Launch checklist

Ship **DoDone** attachments once every box below is ticked.

- [x] Migration applied
- [ ] Storage bucket verified
- [ ] Mobile build cut

## Notes

Rendered with \`react-markdown\`. See the [design doc](https://example.com/doc).

> Images render inline; everything else gets a download row.
`;

/**
 * A stand-in for AttachmentsApi that resolves from memory. Stories and tests
 * both need the component's real load → sign → render sequence without a
 * Supabase project behind it, so this implements the four methods the section
 * actually calls and nothing else.
 */
export function makeAttachmentsApi(options: {
  attachments: TaskAttachment[];
  /** Attachment id → signed URL. Absent ids render as still-loading. */
  urls?: Record<string, string>;
  /** Attachment id → file contents, for the text/markdown previews. */
  text?: Record<string, string>;
}): AttachmentsApi {
  const api = {
    async list() {
      return { data: options.attachments, error: null };
    },
    async signedUrls(list: TaskAttachment[]) {
      const map = new Map<string, string>();
      for (const a of list) {
        const url = options.urls?.[a.id];
        if (url) map.set(a.id, url);
      }
      return { data: map, error: null };
    },
    async fetchText(a: TaskAttachment) {
      return { data: options.text?.[a.id] ?? "", error: null };
    },
    async downloadUrl() {
      return { data: null, error: null };
    },
    async remove() {
      return { error: null };
    },
    async upload() {
      return { data: null, error: new Error("Uploads are stubbed here.") };
    },
  };
  return api as unknown as AttachmentsApi;
}
