import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@do-done/api-client";
import { TasksApi, ProjectsApi } from "@do-done/api-client";
import { generateFocusList, generateWeeklySummary } from "@do-done/task-engine";
import type { Task } from "@do-done/shared";
import { TaskStatus, TaskPriority } from "@do-done/shared";
import { executeOrganize } from "../organize.js";
import { createClock } from "../clock.js";
import {
  addDaysISO,
  buildAgenda,
  describeTask,
  renderAgenda,
  summarizeTaskDates,
  withResolvedDates,
} from "../dates.js";
import { registerPetTools } from "./pets.js";

/**
 * The one paragraph every date-touching tool description leads with. DoDone has
 * two date fields and they are not interchangeable; a caller that assumes
 * "dated" means `due_date` will report a fully planned week as having nothing
 * on it, because almost every DoDone task carries a when_date and almost none
 * carries a due_date.
 */
const DATE_MODEL =
  "DoDone has TWO date fields. `when_date` is the day the user plans to DO the task — " +
  "this is the field the app schedules by and what the user means by 'today', 'tomorrow', " +
  "'this week', and usually by 'due'. `due_date` is a hard external deadline and is rarely set. " +
  "Never report a task as undated because it has no due_date.";

/** A calendar date, the shape every date column in DoDone stores. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD calendar date");

/** A 24-hour wall-clock time; seconds tolerated because Postgres emits them. */
const isoTime = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Expected an HH:MM time of day");

export function registerTools(
  server: McpServer,
  supabase: SupabaseClient,
  userId: string
) {
  const tasks = new TasksApi(supabase, userId);
  const projects = new ProjectsApi(supabase, userId);
  // Resolves the user's calendar day through their timezone preference — the
  // process clock is UTC on the hosted transport. See ../clock.ts.
  const clock = createClock(supabase, userId);

  server.tool(
    "list_tasks",
    `List tasks with optional filters for status, project, priority, date windows, and search. ${DATE_MODEL} ` +
      "Use when_after/when_before to filter by the planned day and due_after/due_before for deadlines. " +
      "For 'what do I have today / this week', prefer get_agenda — it also surfaces overdue work, which a " +
      "plain date window silently excludes. Every returned task carries a `dates` block resolving its dates " +
      "against the user's real today.",
    {
      status: TaskStatus.optional(),
      project_id: z.string().uuid().optional(),
      priority: TaskPriority.optional(),
      when_after: isoDate
        .optional()
        .describe("Only tasks planned on or after this date (when_date)."),
      when_before: isoDate
        .optional()
        .describe("Only tasks planned on or before this date (when_date)."),
      due_after: isoDate
        .optional()
        .describe("Only tasks with a deadline on or after this date."),
      due_before: isoDate
        .optional()
        .describe("Only tasks with a deadline on or before this date."),
      search_query: z.string().optional(),
      limit: z.number().int().positive().max(100).default(50),
    },
    async (params) => {
      const [{ data, error }, { todayISO, timezone }] = await Promise.all([
        tasks.list({ ...params, offset: 0 }),
        clock.now(),
      ]);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                today: todayISO,
                timezone,
                count: data.length,
                tasks: data.map((task) => withResolvedDates(task, todayISO)),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "create_task",
    `Create a new task with title and optional details. ${DATE_MODEL} ` +
      "To schedule a task ('do this Friday', 'add it to today') set when_date — setting due_date instead " +
      "puts it nowhere the user looks. Pass parent_task_id to make it a subtask — it inherits the parent's " +
      "project automatically (override by also passing project_id).",
    {
      title: z.string().min(1).max(500),
      description: z.string().max(5000).optional(),
      status: z
        .enum(["inbox", "later", "not_started", "next", "in_progress"])
        .optional(),
      priority: TaskPriority.optional(),
      project_id: z.string().uuid().optional(),
      when_date: isoDate
        .optional()
        .describe(
          "The day the user plans to do this (YYYY-MM-DD). This is how a task gets scheduled."
        ),
      when_time: isoTime
        .optional()
        .describe("Optional time of day for when_date, HH:MM."),
      due_date: isoDate
        .optional()
        .describe(
          "Hard deadline (YYYY-MM-DD). Only set this for a real external deadline; it does not schedule the task."
        ),
      due_time: isoTime.optional().describe("Deadline time of day, HH:MM."),
      duration_minutes: z.number().int().positive().optional(),
      tags: z.array(z.string()).optional(),
      // Parent task for a subtask. Omit for a top-level task. The subtask
      // inherits the parent's project when project_id isn't given; nesting is
      // capped at 3 levels (a DB trigger rejects a deeper parent).
      parent_task_id: z.string().uuid().optional(),
    },
    async (params) => {
      const { data, error } = await tasks.create(params);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      // Echo the dates back resolved against today, so a mis-set date ("due
      // 2027-08-03") is visible in the confirmation instead of a week later.
      const { todayISO } = await clock.now();
      const dates = data ? summarizeTaskDates(data, todayISO).summary : null;
      return {
        content: [
          {
            type: "text" as const,
            text: `Created task: ${data?.title} (${data?.id})${dates ? ` — ${dates}` : ""}`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_task",
    `Update an existing task's fields. ${DATE_MODEL} ` +
      "Rescheduling ('move it to tomorrow', 'do it Friday instead') means setting when_date. " +
      "Pass null to clear a date.",
    {
      id: z.string().uuid(),
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(5000).nullable().optional(),
      status: TaskStatus.optional(),
      priority: TaskPriority.optional(),
      project_id: z.string().uuid().nullable().optional(),
      when_date: isoDate
        .nullable()
        .optional()
        .describe(
          "The day the user plans to do this (YYYY-MM-DD), or null to unschedule."
        ),
      when_time: isoTime
        .nullable()
        .optional()
        .describe("Time of day for when_date, HH:MM, or null to clear."),
      due_date: isoDate
        .nullable()
        .optional()
        .describe("Hard deadline (YYYY-MM-DD), or null to clear."),
      due_time: isoTime.nullable().optional(),
      duration_minutes: z.number().int().positive().nullable().optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ id, ...updates }) => {
      // Tasks completed via MCP are tagged actor='claude' so Pip's activity
      // log honestly attributes the work. Other updates also pass 'claude'
      // — feeding only fires on status→done transitions inside TasksApi.update.
      const { data, error } = await tasks.update(id, updates, "claude");
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      const { todayISO } = await clock.now();
      const dates = data ? summarizeTaskDates(data, todayISO).summary : null;
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated task: ${data?.title} (${data?.id})${dates ? ` — ${dates}` : ""}`,
          },
        ],
      };
    }
  );

  server.tool(
    "complete_task",
    "Mark a task as done. The completion is automatically tagged as performed by Claude in Pip's activity log so the user sees honest attribution. After completing, consider calling `narrate_task_completion` to add a brief story about what you actually did.",
    { id: z.string().uuid() },
    async ({ id }) => {
      const { data, error } = await tasks.complete(id, "claude");
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return {
        content: [
          {
            type: "text" as const,
            text: `Completed task: ${data?.title}`,
          },
        ],
      };
    }
  );

  server.tool(
    "search_tasks",
    `Full-text search across all tasks. ${DATE_MODEL} Results carry a \`dates\` block resolved against the user's real today.`,
    { query: z.string().min(1) },
    async ({ query }) => {
      const [{ data, error }, { todayISO, timezone }] = await Promise.all([
        tasks.search(query),
        clock.now(),
      ]);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return {
        content: [
          {
            type: "text" as const,
            text: data.length > 0
              ? JSON.stringify(
                  {
                    today: todayISO,
                    timezone,
                    count: data.length,
                    tasks: data.map((task) => withResolvedDates(task, todayISO)),
                  },
                  null,
                  2
                )
              : "No tasks found matching your query.",
          },
        ],
      };
    }
  );

  server.tool(
    "get_agenda",
    `What is on for a day or a range of days — the tool to answer "what do I have today?", ` +
      `"what's due tomorrow?", "what's coming up this week?". ${DATE_MODEL} ` +
      "Returns everything overdue, then one section per day listing the tasks scheduled (when_date) " +
      "or due (due_date) on it, all resolved against the user's real calendar day in their own timezone. " +
      "Tasks with no date at all are never listed here — use list_tasks for those.",
    {
      start_date: isoDate
        .optional()
        .describe("First day of the window, YYYY-MM-DD. Defaults to today."),
      days: z
        .number()
        .int()
        .min(1)
        .max(31)
        .default(1)
        .describe("How many days from start_date to cover. 7 for a week."),
      include_overdue: z
        .boolean()
        .default(true)
        .describe(
          "Include the overdue section. Overdue work is dated in the past, so a date window alone would hide it."
        ),
    },
    async ({ start_date, days, include_overdue }) => {
      const { todayISO, timezone } = await clock.now();
      const startISO = start_date ?? todayISO;
      const endISO = addDaysISO(startISO, days - 1);

      const [window, overdue] = await Promise.all([
        tasks.getDatedBetween(startISO, endISO),
        include_overdue
          ? tasks.getOverdue(todayISO)
          : Promise.resolve({ data: [] as Task[], error: null as Error | null }),
      ]);
      const error = window.error ?? overdue.error;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };

      // Both queries can return the same row (a task dated in the past that is
      // also inside the window when the caller asks about past days), so the
      // agenda is built from the union and dedupes by id.
      const byId = new Map<string, (typeof window.data)[number]>();
      for (const task of [...overdue.data, ...window.data]) byId.set(task.id, task);

      const agenda = buildAgenda([...byId.values()], {
        todayISO,
        timezone,
        startISO,
        days,
        includeOverdue: include_overdue,
      });

      return { content: [{ type: "text" as const, text: renderAgenda(agenda) }] };
    }
  );

  server.tool(
    "get_focus_tasks",
    `Get today's prioritized focus list — the handful of tasks to work on right now, ranked by urgency. ${DATE_MODEL} ` +
      "This is a ranking, not a date query: it can include undated tasks and omit dated ones. " +
      "For 'what do I have on today', call get_agenda instead.",
    {},
    async () => {
      const [{ data: allTasks, error }, { todayISO, timezone }] =
        await Promise.all([
          tasks.list({ limit: 100, offset: 0 }),
          clock.now(),
        ]);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };

      const focusList = generateFocusList(allTasks);
      const formatted = focusList
        .map((t, i) => `${i + 1}. ${describeTask(t, todayISO)}`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: focusList.length > 0
              ? `Today is ${todayISO} in ${timezone}.\n\nFocus tasks:\n\n${formatted}`
              : "No focus tasks — your plate is clear!",
          },
        ],
      };
    }
  );

  server.tool(
    "get_weekly_summary",
    "Get a summary of this week's task activity, completion stats, and patterns",
    {},
    async () => {
      const { data: allTasks, error } = await tasks.list({
        limit: 100,
        offset: 0,
      });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };

      const summary = generateWeeklySummary(allTasks);
      const text = [
        `## Weekly Summary`,
        ``,
        `- Completed: ${summary.completed_count} tasks`,
        `- Created: ${summary.created_count} tasks`,
        `- Completion rate: ${Math.round(summary.completion_rate * 100)}%`,
        `- Overdue: ${summary.overdue_count} tasks`,
        summary.most_productive_day
          ? `- Most productive day: ${summary.most_productive_day}`
          : "",
        ``,
        `### Priority breakdown`,
        `- P1 (Urgent): ${summary.priority_distribution.p1}`,
        `- P2 (High): ${summary.priority_distribution.p2}`,
        `- P3 (Medium): ${summary.priority_distribution.p3}`,
        `- P4 (Low): ${summary.priority_distribution.p4}`,
      ]
        .filter(Boolean)
        .join("\n");

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "organize_tasks",
    "Execute bulk task operations described in natural language. Supported: 'archive done tasks older than N days', 'set all overdue tasks to p1', 'complete all p4 tasks', 'archive overdue tasks'.",
    { instructions: z.string().min(1) },
    async ({ instructions }) => {
      const outcome = await executeOrganize(tasks, instructions);
      if (!outcome.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${outcome.error}` }],
        };
      }
      const { result, parsed } = outcome;
      const filterDesc =
        Object.entries(parsed.filter)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ") || "all tasks";
      const actionDesc =
        parsed.action.kind === "set_priority"
          ? `set_priority → ${parsed.action.priority}`
          : parsed.action.kind === "set_status"
            ? `set_status → ${parsed.action.status}`
            : parsed.action.kind;
      const lines = [
        `Parsed: ${actionDesc} where ${filterDesc}`,
        `Matched: ${result.matched} task${result.matched === 1 ? "" : "s"}`,
        `Applied: ${result.applied}`,
      ];
      if (result.preview.length > 0) {
        lines.push("", "Affected tasks:");
        for (const title of result.preview) lines.push(`  - ${title}`);
        if (result.matched > result.preview.length) {
          lines.push(
            `  ... and ${result.matched - result.preview.length} more`
          );
        }
      }
      if (result.errors.length > 0) {
        lines.push(
          "",
          `${result.errors.length} error${result.errors.length === 1 ? "" : "s"}:`
        );
        for (const e of result.errors) lines.push(`  ! ${e}`);
      }
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  server.tool(
    "list_projects",
    "List the user's projects in their current display order (the order chosen via drag-to-reorder). Returns each project's id, name, color, icon, and sort_order — call this first to get the ids needed by reorder_projects.",
    {},
    async () => {
      const { data, error } = await projects.list();
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return {
        content: [
          {
            type: "text" as const,
            text:
              data.length > 0
                ? JSON.stringify(
                    data.map((p) => ({
                      id: p.id,
                      name: p.name,
                      color: p.color,
                      icon: p.icon,
                      sort_order: p.sort_order,
                    })),
                    null,
                    2
                  )
                : "No projects yet.",
          },
        ],
      };
    }
  );

  server.tool(
    "reorder_projects",
    "Set the order projects are shown in everywhere (sidebar, pickers, mobile). Pass ALL of the user's project ids in the desired top-to-bottom order — call list_projects first to get them. Any project omitted from the list keeps its old position value and may end up interleaved, so always send the complete set.",
    {
      ordered_ids: z
        .array(z.string().uuid())
        .min(1)
        .describe(
          "Every project id, in the desired display order (first = top)."
        ),
    },
    async ({ ordered_ids }) => {
      const { error } = await projects.reorder(ordered_ids);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return {
        content: [
          {
            type: "text" as const,
            text: `Reordered ${ordered_ids.length} project${ordered_ids.length === 1 ? "" : "s"}.`,
          },
        ],
      };
    }
  );

  // Pet tools: get_pet_state, propose_pet_goal, accept_pet_goal,
  // narrate_task_completion, get_pet_history.
  registerPetTools(server, supabase, userId);
}
