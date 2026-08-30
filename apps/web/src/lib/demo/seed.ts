import {
  addDaysLocalISO,
  learnableTerm,
  todayLocalISO,
  type CalendarEvent,
  type PantryEntry,
  type Location,
  type Project,
  type Task,
  type TaskLocation,
  type TaskPriority,
  type TaskStatus,
  type TriggerType,
} from "@do-done/shared";
import { DEMO_USER_ID } from "./mode";

/**
 * The sandbox's starting data: a week of somebody's actual life, dated
 * relative to whenever you happen to open it.
 *
 * Everything here is a pure function of one ISO day, which is what lets the
 * store re-seed at midnight and the tests assert on it without freezing a
 * clock. Ids are stable across seeds so a link into the demo keeps working
 * within a day.
 */

/** A stable, uuid-shaped id — the schemas validate the shape, so "demo-3" won't do. */
function demoId(n: number): string {
  return `d0d0d0d0-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const PROJECT_SEED: Array<
  Pick<Project, "name" | "color" | "icon"> & { kind?: Project["kind"] }
> = [
  { name: "Work", color: "#6366f1", icon: "💼" },
  { name: "Home", color: "#10b981", icon: "🏠" },
  { name: "Health", color: "#f43f5e", icon: "🏃" },
  { name: "Side project", color: "#f59e0b", icon: "🚀" },
  { name: "Reading", color: "#8b5cf6", icon: "📚" },
  // Two shopping lists, so the sandbox shows the thing the Lists section is
  // for — and, more usefully, shows that the eight grocery items below are
  // nowhere to be seen in Today, Inbox or All. A demo where lists were absent
  // would be a demo of the feature's least interesting half.
  { name: "Groceries", color: "#22c55e", icon: "🛒", kind: "list" },
  { name: "Amazon", color: "#f59e0b", icon: "📦", kind: "list" },
];

/** Index into PROJECT_SEED, by name, for readable task definitions below. */
const P = {
  work: 0,
  home: 1,
  health: 2,
  side: 3,
  reading: 4,
  groceries: 5,
  amazon: 6,
} as const;

/**
 * Saved places, so the sandbox can show a reminder that is attached to
 * somewhere rather than to a day. Real coordinates, because the map preview
 * fetches real tiles — a made-up pair lands the pin in the North Sea.
 */
const PLACE_SEED: Array<
  Pick<Location, "name" | "latitude" | "longitude" | "radius_meters" | "address">
> = [
  {
    name: "Sainsbury's",
    latitude: 51.5246,
    longitude: -0.1339,
    radius_meters: 200,
    address: "Camden Road, London",
  },
  {
    name: "The office",
    latitude: 51.5155,
    longitude: -0.1416,
    radius_meters: 200,
    address: "Great Portland Street, London",
  },
  {
    name: "Post office",
    latitude: 51.5205,
    longitude: -0.1281,
    radius_meters: 100,
    address: "Tottenham Court Road, London",
  },
];

/** Index into PLACE_SEED, by name, for readable task definitions below. */
const L = { supermarket: 0, office: 1, postOffice: 2 } as const;

interface TaskSeed {
  title: string;
  /** Days from today. Omit for an undated task. */
  day?: number;
  time?: string;
  deadlineDay?: number;
  project?: number;
  priority?: TaskPriority;
  status?: TaskStatus;
  minutes?: number;
  /** Bare words — the leading `#` is quick-add *syntax*, stripped by the
   *  parser before it ever reaches the column. Seeding "#finance" here renders
   *  as "##finance", since the chip adds its own. */
  tags?: string[];
  description?: string;
  recurrence?: string;
  /** Index (within this array) of this task's parent. */
  parent?: number;
  /** Days ago it was completed. Only read for `done` tasks. */
  doneDaysAgo?: number;
  focus?: "include" | "exclude";
  /** Location reminders: an index into PLACE_SEED plus the direction. */
  places?: Array<{ place: number; trigger: TriggerType }>;
}

/**
 * Hand-written rather than generated: a demo is a piece of writing. Generated
 * filler ("Task 14") reads as filler, and the point of the sandbox is to look
 * like a real week so the views have something true to say about it.
 */
const TASK_SEED: TaskSeed[] = [
  // ── Overdue — every task app's real first impression ──────────────
  {
    title: "Send the Q3 numbers to Priya",
    day: -2,
    project: P.work,
    priority: "p1",
    minutes: 30,
    tags: ["finance"],
    description:
      "She needs the revenue split by region before the board pack goes out.",
  },
  {
    title: "Renew the car insurance",
    day: -1,
    deadlineDay: 3,
    project: P.home,
    priority: "p2",
    minutes: 20,
  },

  // ── Today ─────────────────────────────────────────────────────────
  {
    title: "Write the launch announcement",
    day: 0,
    time: "09:30",
    project: P.work,
    priority: "p1",
    minutes: 90,
    tags: ["writing"],
    description:
      "Short and human. Lead with what changed for the user, not the release number.",
    status: "in_progress",
  },
  {
    title: "Draft the opening paragraph",
    day: 0,
    project: P.work,
    priority: "p2",
    minutes: 20,
    parent: 2,
    status: "done",
    doneDaysAgo: 0,
  },
  {
    title: "Pull three screenshots for the post",
    day: 0,
    project: P.work,
    priority: "p3",
    minutes: 15,
    parent: 2,
  },
  {
    title: "Design review with Sam",
    day: 0,
    time: "14:00",
    project: P.work,
    priority: "p2",
    minutes: 45,
  },
  {
    title: "Run — 5k easy",
    day: 0,
    time: "18:00",
    project: P.health,
    priority: "p3",
    minutes: 40,
    recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
  },
  {
    title: "Book the dentist",
    day: 0,
    project: P.health,
    priority: "p3",
    minutes: 10,
    status: "next",
  },
  {
    title: "Reply to the landlord about the boiler",
    day: 0,
    project: P.home,
    priority: "p2",
    minutes: 10,
    // Both directions at one place: the folded row in the editor reads
    // "Arriving at and leaving The office" rather than naming a count.
    places: [
      { place: L.office, trigger: "enter" },
      { place: L.office, trigger: "exit" },
    ],
  },

  // ── Tomorrow and the rest of the week ─────────────────────────────
  {
    title: "Ship the onboarding empty states",
    day: 1,
    time: "10:00",
    project: P.work,
    priority: "p1",
    minutes: 120,
    tags: ["design"],
    description: "The skeleton → empty → error trio, on every list.",
  },
  {
    title: "Grocery run",
    day: 1,
    project: P.home,
    priority: "p4",
    minutes: 45,
    tags: ["errands"],
    places: [{ place: L.supermarket, trigger: "enter" }],
  },
  {
    title: "Read two chapters of Thinking in Systems",
    day: 1,
    project: P.reading,
    priority: "p4",
    minutes: 45,
  },
  {
    title: "Fix the flaky checkout test",
    day: 2,
    project: P.work,
    priority: "p2",
    minutes: 60,
    tags: ["bug"],
  },
  {
    title: "Sketch the pricing page",
    day: 2,
    project: P.side,
    priority: "p3",
    minutes: 90,
  },
  {
    title: "Call Mum",
    day: 3,
    time: "19:00",
    project: P.home,
    priority: "p2",
    minutes: 30,
    recurrence: "FREQ=WEEKLY",
  },
  {
    title: "Physio exercises",
    day: 3,
    project: P.health,
    priority: "p3",
    minutes: 20,
  },
  {
    title: "Team retro",
    day: 4,
    time: "15:30",
    project: P.work,
    priority: "p3",
    minutes: 60,
  },
  {
    title: "Submit the conference talk proposal",
    day: 4,
    deadlineDay: 5,
    project: P.side,
    priority: "p1",
    minutes: 60,
    description: "300 words on shipping design systems in small teams.",
  },
  {
    title: "Deep clean the kitchen",
    day: 5,
    project: P.home,
    priority: "p4",
    minutes: 60,
  },
  {
    title: "Long run — 12k",
    day: 6,
    time: "08:00",
    project: P.health,
    priority: "p3",
    minutes: 75,
  },

  // ── Next week and beyond ──────────────────────────────────────────
  {
    title: "Plan the Q4 roadmap",
    day: 8,
    project: P.work,
    priority: "p1",
    minutes: 120,
  },
  {
    title: "Renew passport",
    day: 10,
    deadlineDay: 21,
    project: P.home,
    priority: "p2",
    minutes: 45,
    places: [{ place: L.postOffice, trigger: "enter" }],
  },
  {
    title: "Set up analytics on the landing page",
    day: 11,
    project: P.side,
    priority: "p3",
    minutes: 45,
  },
  {
    title: "Dinner with Alex and Rae",
    day: 12,
    time: "19:30",
    project: P.home,
    priority: "p3",
    minutes: 150,
  },

  // ── Inbox: caught, not yet sorted ─────────────────────────────────
  {
    title: "Look into that standing desk everyone keeps mentioning",
    status: "inbox",
    priority: "p4",
  },
  {
    title: "Idea: weekly review template inside DoDone",
    status: "inbox",
    project: P.side,
    priority: "p3",
    description: "Five prompts, prefilled with last week's completed tasks.",
  },
  {
    title: "Cancel the subscription I stopped using",
    status: "inbox",
    priority: "p4",
    minutes: 10,
  },
  {
    title: "Ask Jo which climbing gym they use",
    status: "inbox",
    priority: "p4",
  },
  {
    title: "Back up the photo library",
    status: "later",
    project: P.home,
    priority: "p4",
    minutes: 30,
  },

  // ── Already done — so Completed and the streaks aren't empty ──────
  {
    title: "Fix the sign-in redirect loop",
    project: P.work,
    priority: "p1",
    status: "done",
    doneDaysAgo: 1,
    minutes: 45,
  },
  {
    title: "Water the plants",
    project: P.home,
    priority: "p4",
    status: "done",
    doneDaysAgo: 1,
  },
  {
    title: "Swim — 1km",
    project: P.health,
    priority: "p3",
    status: "done",
    doneDaysAgo: 2,
    minutes: 45,
  },
  {
    title: "Write up the migration notes",
    project: P.work,
    priority: "p2",
    status: "done",
    doneDaysAgo: 2,
    minutes: 30,
  },
  {
    title: "Finish 'The Mom Test'",
    project: P.reading,
    priority: "p4",
    status: "done",
    doneDaysAgo: 3,
  },
  {
    title: "Set up the new laptop",
    project: P.work,
    priority: "p2",
    status: "done",
    doneDaysAgo: 4,
    minutes: 90,
  },

  // ── Shopping lists ────────────────────────────────────────────────
  //
  // Mostly unprioritised and undated, because most things to buy are. None of
  // them appear in Today, Inbox, Upcoming or All. That absence is the feature,
  // and it is visible in the sandbox because these rows exist.
  //
  // Two deliberate exceptions, both there to exercise `itemSubline`: store
  // hints, which the row is the only place in the app to show — one item names
  // two shops, since an item can — and one dated item, which also shows that a
  // list item with a scheduled date still does not reach Today. The old "no
  // dates at all" rule left that untested.
  { title: "Whole milk", project: P.groceries, tags: ["at:Trader Joe's"] },
  { title: "Bananas", project: P.groceries },
  { title: "Greek yoghurt", project: P.groceries, tags: ["at:Trader Joe's"] },
  { title: "Sourdough", project: P.groceries },
  { title: "Paper towels", project: P.groceries, tags: ["at:Target", "at:Costco"] },
  { title: "Parmesan", project: P.groceries },
  {
    title: "Ice for the cool box",
    project: P.groceries,
    tags: ["at:Target"],
    day: 2,
  },
  { title: "Eggs", project: P.groceries, status: "done", doneDaysAgo: 0 },
  { title: "Butter", project: P.groceries, status: "done", doneDaysAgo: 0 },
  { title: "USB-C cable, 2m", project: P.amazon },
  { title: "Replacement kettle filter", project: P.amazon },
  { title: "Birthday card", project: P.amazon },
];

/**
 * The sandbox's shopping history.
 *
 * Seeded because an empty drawer shows nothing useful: the pantry is about what
 * a list looks like after months of shopping, and a visitor arriving at `/demo`
 * has no history of their own.
 *
 * The entries span all three bands on purpose — weekly items in the last
 * fortnight, monthly items behind them, and twice-a-year items further back.
 * The bands only make sense when all three have something in them.
 */
const PANTRY_SEED: Array<{
  list: number;
  title: string;
  daysAgo: number;
  buys: number;
  stores?: string[];
  /** Days between recent buys, which is what cadence is measured from. */
  gaps?: number[];
}> = [
  // Last 2 weeks — the weekly shop.
  { list: P.groceries, title: "Greek yoghurt", daysAgo: 6, buys: 14, stores: ["Trader Joe's"], gaps: [7, 6, 8, 7, 6] },
  { list: P.groceries, title: "Spinach", daysAgo: 6, buys: 9, gaps: [7, 8, 6, 7] },
  { list: P.groceries, title: "Chicken thighs", daysAgo: 9, buys: 11, stores: ["Trader Joe's"], gaps: [8, 7, 6, 9] },
  // Bought at either, which is what an item with two shops looks like coming
  // back out of the drawer: it returns to the list carrying both.
  { list: P.groceries, title: "Coffee beans", daysAgo: 11, buys: 8, stores: ["Trader Joe's", "Target"], gaps: [14, 12, 15, 13] },
  { list: P.groceries, title: "Tomatoes", daysAgo: 13, buys: 6, gaps: [10, 9, 12] },
  // Last 2 months — the fortnightly and monthly things.
  { list: P.groceries, title: "Olive oil", daysAgo: 24, buys: 4, gaps: [90, 84, 96] },
  { list: P.groceries, title: "Rice", daysAgo: 31, buys: 5, gaps: [88, 92, 85] },
  { list: P.groceries, title: "Dish soap", daysAgo: 38, buys: 6, stores: ["Target"], gaps: [44, 40, 46] },
  { list: P.groceries, title: "Bin bags", daysAgo: 45, buys: 5, stores: ["Target"], gaps: [60, 55, 58] },
  { list: P.groceries, title: "Frozen berries", daysAgo: 55, buys: 3, gaps: [50, 60] },
  // Earlier — the twice-a-year things, and the one-off nobody will buy again.
  { list: P.groceries, title: "Baking soda", daysAgo: 96, buys: 3, gaps: [150, 170] },
  { list: P.groceries, title: "Vanilla extract", daysAgo: 140, buys: 2, gaps: [200] },
  { list: P.groceries, title: "Foil", daysAgo: 190, buys: 3, gaps: [180, 200] },
  { list: P.groceries, title: "Birthday candles", daysAgo: 240, buys: 1 },
  { list: P.amazon, title: "Printer paper", daysAgo: 20, buys: 4, gaps: [70, 80, 75] },
  { list: P.amazon, title: "AA batteries", daysAgo: 74, buys: 3, gaps: [120, 140] },
];

/** Builds the seeded history for one list, dated relative to now. */
export function demoPantryFor(listId: string): PantryEntry[] {
  const now = Date.now();
  return PANTRY_SEED.filter((e) => demoId(e.list + 1) === listId).map((e) => ({
    term: learnableTerm(e.title) ?? e.title.toLowerCase(),
    title: e.title,
    last_bought_at: new Date(now - e.daysAgo * 86_400_000).toISOString(),
    buy_count: e.buys,
    gaps: e.gaps ?? [],
    stores: e.stores ?? [],
  }));
}

export interface DemoSeed {
  projects: Project[];
  tasks: Task[];
  events: CalendarEvent[];
  locations: Location[];
  /** The raw link triples, exactly as `task_locations` holds them. */
  taskLocations: TaskLocation[];
}

/** Build the sandbox's starting data, dated relative to `today` (YYYY-MM-DD). */
export function buildDemoSeed(today: string = todayLocalISO()): DemoSeed {
  // Midday, so adding whole days can't tip over a DST boundary into the day
  // before or after the one being asked for.
  const base = new Date(`${today}T12:00:00`);
  const dayOf = (offset: number) => addDaysLocalISO(offset, base);
  /** Timestamps are only ever displayed relatively, so 09:00 local will do. */
  const stamp = (daysAgo: number) => `${dayOf(-daysAgo)}T09:00:00.000Z`;

  const projects: Project[] = PROJECT_SEED.map((p, i) => ({
    id: demoId(i + 1),
    user_id: DEMO_USER_ID,
    name: p.name,
    color: p.color,
    icon: p.icon,
    parent_project_id: null,
    sort_order: i * 1000,
    kind: p.kind ?? "tasks",
    created_at: stamp(40),
    updated_at: stamp(40),
  }));

  const tasks: Task[] = TASK_SEED.map((s, i) => {
    const id = demoId(100 + i);
    const parentId = s.parent === undefined ? null : demoId(100 + s.parent);
    const status: TaskStatus = s.status ?? "not_started";
    return {
      id,
      user_id: DEMO_USER_ID,
      title: s.title,
      description: s.description ?? null,
      status,
      priority: s.priority ?? "p4",
      project_id: s.project === undefined ? null : projects[s.project]!.id,
      scheduled_date: s.day === undefined ? null : dayOf(s.day),
      scheduled_time: s.time ?? null,
      deadline_date: s.deadlineDay === undefined ? null : dayOf(s.deadlineDay),
      deadline_time: null,
      duration_minutes: s.minutes ?? null,
      recurrence_rule: s.recurrence ?? null,
      calendar_event_id: null,
      tags: s.tags ?? [],
      parent_task_id: parentId,
      depth: parentId ? 1 : 0,
      sort_order: i * 100,
      focus_override: s.focus ?? null,
      // What the DB trigger derives. Computed from the seeded project rather
      // than declared per row, so a task moved between the two seed lists
      // can't be flagged wrongly.
      is_list_item:
        s.project !== undefined && projects[s.project]!.kind === "list",
      created_at: stamp(Math.min(30, i + 2)),
      updated_at: stamp(Math.min(30, i + 1)),
      completed_at:
        status === "done" ? stamp(s.doneDaysAgo ?? 1) : null,
    };
  });

  // Ids start at 300 so they can't collide with a project (1…) or a task
  // (100…) — the sandbox validates against the real schemas, and a duplicate
  // uuid would be a bug you'd only find by clicking on it.
  const locations: Location[] = PLACE_SEED.map((p, i) => ({
    id: demoId(300 + i),
    user_id: DEMO_USER_ID,
    name: p.name,
    latitude: p.latitude,
    longitude: p.longitude,
    radius_meters: p.radius_meters,
    address: p.address,
    is_saved: true,
    created_at: stamp(30),
    updated_at: stamp(30),
  }));

  const taskLocations: TaskLocation[] = TASK_SEED.flatMap((s, i) =>
    (s.places ?? []).map((link) => ({
      task_id: demoId(100 + i),
      location_id: locations[link.place]!.id,
      trigger_type: link.trigger,
    }))
  );

  return {
    projects,
    tasks,
    events: buildDemoEvents(dayOf),
    locations,
    taskLocations,
  };
}

/**
 * A handful of read-only calendar events, so the Today strip and the Upcoming
 * columns show the thing DoDone's calendar sync is actually for: your tasks
 * and your meetings in one column, with the gaps between them visible.
 */
function buildDemoEvents(dayOf: (offset: number) => string): CalendarEvent[] {
  const event = (
    n: number,
    title: string,
    day: number,
    start: string,
    end: string,
    color: string
  ): CalendarEvent => ({
    id: `demo-event-${n}`,
    calendar_id: "demo",
    calendar_name: "Calendar",
    color,
    title,
    all_day: false,
    start_date: null,
    end_date: null,
    start: `${dayOf(day)}T${start}:00`,
    end: `${dayOf(day)}T${end}:00`,
    location: null,
    html_link: null,
  });

  return [
    event(1, "Standup", 0, "09:00", "09:15", "#6366f1"),
    event(2, "1:1 with Priya", 0, "11:00", "11:30", "#10b981"),
    event(3, "Lunch with the design team", 0, "12:30", "13:30", "#f59e0b"),
    event(4, "Standup", 1, "09:00", "09:15", "#6366f1"),
    event(5, "Customer call — Northwind", 1, "16:00", "17:00", "#f43f5e"),
    event(6, "Standup", 2, "09:00", "09:15", "#6366f1"),
    event(7, "All-hands", 4, "16:00", "17:00", "#8b5cf6"),
  ];
}
