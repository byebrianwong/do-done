import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@do-done/api-client";
import { TasksApi } from "@do-done/api-client";
import { generateFocusList, generateWeeklySummary } from "@do-done/task-engine";
import { TaskStatus, TaskPriority } from "@do-done/shared";
import { executeOrganize } from "../organize.js";
import { registerPetTools } from "./pets.js";

export function registerTools(
  server: McpServer,
  supabase: SupabaseClient,
  userId: string
) {
  const tasks = new TasksApi(supabase, userId);

  server.tool(
    "list_tasks",
    "List tasks with optional filters for status, project, priority, date range, and search",
    {
      status: z.enum(["inbox", "todo", "in_progress", "done", "archived"]).optional(),
      project_id: z.string().uuid().optional(),
      priority: z.enum(["p1", "p2", "p3", "p4"]).optional(),
      due_before: z.string().optional(),
      due_after: z.string().optional(),
      search_query: z.string().optional(),
      limit: z.number().int().positive().max(100).default(50),
    },
    async (params) => {
      const { data, error } = await tasks.list({ ...params, offset: 0 });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "create_task",
    "Create a new task with title and optional details",
    {
      title: z.string().min(1).max(500),
      description: z.string().max(5000).optional(),
      status: z.enum(["inbox", "todo", "in_progress"]).optional(),
      priority: z.enum(["p1", "p2", "p3", "p4"]).optional(),
      project_id: z.string().uuid().optional(),
      due_date: z.string().optional(),
      due_time: z.string().optional(),
      duration_minutes: z.number().int().positive().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (params) => {
      const { data, error } = await tasks.create(params);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return {
        content: [
          {
            type: "text" as const,
            text: `Created task: ${data?.title} (${data?.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_task",
    "Update an existing task's fields",
    {
      id: z.string().uuid(),
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(5000).nullable().optional(),
      status: z.enum(["inbox", "todo", "in_progress", "done", "archived"]).optional(),
      priority: z.enum(["p1", "p2", "p3", "p4"]).optional(),
      project_id: z.string().uuid().nullable().optional(),
      due_date: z.string().nullable().optional(),
      due_time: z.string().nullable().optional(),
      duration_minutes: z.number().int().positive().nullable().optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ id, ...updates }) => {
      // Tasks completed via MCP are tagged actor='claude' so Pip's activity
      // log honestly attributes the work. Other updates also pass 'claude'
      // — feeding only fires on status→done transitions inside TasksApi.update.
      const { data, error } = await tasks.update(id, updates, "claude");
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated task: ${data?.title} (${data?.id})`,
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
    "Full-text search across all tasks",
    { query: z.string().min(1) },
    async ({ query }) => {
      const { data, error } = await tasks.search(query);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return {
        content: [
          {
            type: "text" as const,
            text: data.length > 0
              ? JSON.stringify(data, null, 2)
              : "No tasks found matching your query.",
          },
        ],
      };
    }
  );

  server.tool(
    "get_focus_tasks",
    "Get today's prioritized focus list — the tasks to work on right now",
    {},
    async () => {
      const { data: allTasks, error } = await tasks.list({
        limit: 100,
        offset: 0,
      });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };

      const focusList = generateFocusList(allTasks);
      const formatted = focusList
        .map(
          (t, i) =>
            `${i + 1}. [${t.priority}] ${t.title}${t.due_date ? ` (due: ${t.due_date})` : ""}${t.due_time ? ` at ${t.due_time}` : ""}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: focusList.length > 0
              ? `Focus tasks for today:\n\n${formatted}`
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

  // Pet tools: get_pet_state, propose_pet_goal, accept_pet_goal,
  // narrate_task_completion, get_pet_history.
  registerPetTools(server, supabase, userId);
}
