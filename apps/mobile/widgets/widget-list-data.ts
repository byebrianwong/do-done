/**
 * What a List widget reads, and the memo that keeps a refresh sweep to one
 * round of queries.
 *
 * Kept apart from `widget-list-layout.ts` for the reason `widget-data.ts` is
 * kept apart from `widget-layout.ts`: this module reaches for `@/lib/supabase`,
 * which in a headless widget context is the module most likely to be
 * unconstructable, and the grouping has to stay importable in a node test.
 *
 * Two doors. `loadListWidget(widgetId)` is the one a launcher update takes —
 * one widget, one answer. `createListWidgetLoader()` is for the app's own
 * foreground refresh, which redraws *every* List widget on the home screen and
 * would otherwise re-read the project list and the aisle memory once per
 * widget. Both take the same path, so a widget drawn from the app and the same
 * widget drawn by the launcher cannot say different things.
 */

import type { AisleMemory, Project, Task } from '@do-done/shared';
import { isListProject, splitProjects } from '@do-done/shared';
import {
  supabase,
  getAisleTermsApi,
  getProjectsApi,
  getTasksApi,
} from '@/lib/supabase';

import { readTarget, targetDecision } from './widget-target';

export const LIST_WIDGET_NAME = 'List';

/** How many of a project's tasks a widget reads. Far more than it can draw. */
const PROJECT_TASK_LIMIT = 200;

export type ListWidgetData =
  | { state: 'signed-out' }
  /** Nothing pinned yet, or what was pinned is gone. Draw the picker. */
  | { state: 'pick'; candidates: Project[] }
  | {
      state: 'show';
      project: Project;
      isList: boolean;
      /** Items or tasks as read; the layout does the filtering. */
      tasks: Task[];
      /** Taught aisles. Empty is the correct fallback, not a failure. */
      aisleMemory: AisleMemory;
    };

/**
 * The lists and projects a widget can be pinned to, lists first.
 *
 * Lists lead because they are the reason this widget exists: a shopping list is
 * the thing people most want on a home screen and the one the app gives no
 * other shortcut to. Within each half the user's own order is kept.
 */
export function pickerCandidates(projects: Project[]): Project[] {
  const { lists, projects: rest } = splitProjects(projects);
  return [...lists, ...rest];
}

/**
 * One refresh sweep's worth of memoised reads.
 *
 * The project list and the aisle memory are the same for every widget on the
 * screen, and two widgets pinned to the same list should cost one query rather
 * than two. Deliberately per-sweep rather than module-level: a widget update is
 * the one moment the data is meant to be re-read, and a cache that outlived the
 * sweep would be the reason a completed task stayed on the home screen.
 */
export function createListWidgetLoader() {
  let projectsOnce: Promise<Project[]> | null = null;
  let memoryOnce: Promise<AisleMemory> | null = null;
  const tasksById = new Map<string, Promise<Task[]>>();

  const projects = () => (projectsOnce ??= loadProjects());
  const memory = () => (memoryOnce ??= loadAisleMemory());

  function tasksFor(project: Project): Promise<Task[]> {
    const cached = tasksById.get(project.id);
    if (cached) return cached;
    const fresh = isListProject(project)
      ? loadItems(project.id)
      : loadProjectTasks(project.id);
    tasksById.set(project.id, fresh);
    return fresh;
  }

  async function load(widgetId: number): Promise<ListWidgetData> {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) return { state: 'signed-out' };

    const all = await projects();
    const candidates = pickerCandidates(all);
    const stored = await readTarget(widgetId);
    const decision = targetDecision({
      stored,
      known: candidates.map((p) => p.id),
    });
    if (decision.action === 'pick') return { state: 'pick', candidates };

    const project = candidates.find((p) => p.id === decision.id);
    // `targetDecision` only names an id it was given, so this is unreachable —
    // but a widget that threw here would draw nothing at all, and the picker is
    // a recoverable answer.
    if (!project) return { state: 'pick', candidates };

    const isList = isListProject(project);
    const [tasks, aisleMemory] = await Promise.all([
      tasksFor(project),
      isList ? memory() : Promise.resolve(new Map() as AisleMemory),
    ]);
    return { state: 'show', project, isList, tasks, aisleMemory };
  }

  return { load };
}

/** One widget's data. What a launcher update calls. */
export function loadListWidget(widgetId: number): Promise<ListWidgetData> {
  return createListWidgetLoader().load(widgetId);
}

async function loadProjects(): Promise<Project[]> {
  try {
    const api = await getProjectsApi();
    const { data, error } = await api.list();
    if (error) return [];
    return data;
  } catch {
    return [];
  }
}

/**
 * A list's items, bought ones included — the subtitle counts the cart.
 *
 * `listItems` is the only read in the app that asks for the rows every other
 * one filters out, which is why a shopping list cannot be drawn from the
 * `loadWidgetTasks` the other four widgets share.
 */
async function loadItems(listId: string): Promise<Task[]> {
  try {
    const api = await getTasksApi();
    const { data, error } = await api.listItems(listId);
    if (error) return [];
    return data;
  } catch {
    return [];
  }
}

async function loadProjectTasks(projectId: string): Promise<Task[]> {
  try {
    const api = await getTasksApi();
    const { data, error } = await api.list({
      project_id: projectId,
      limit: PROJECT_TASK_LIMIT,
      offset: 0,
    });
    if (error) return [];
    return data;
  } catch {
    return [];
  }
}

/**
 * What the user has taught about their own words.
 *
 * A failure is an empty map rather than an error, exactly as `AisleTermsApi`
 * promises: without it the lexicon still guesses, which is a good answer, and a
 * widget that refused to draw because a preference did not load would be a much
 * worse one.
 */
async function loadAisleMemory(): Promise<AisleMemory> {
  try {
    const api = await getAisleTermsApi();
    const { data } = await api.load();
    return data;
  } catch {
    return new Map();
  }
}
