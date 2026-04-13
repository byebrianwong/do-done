import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@do-done/api-client";
import { TasksApi } from "@do-done/api-client";
import { generateFocusList, generateWeeklySummary } from "@do-done/task-engine";
import { TaskStatus, TaskPriority } from "@do-done/shared";

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
      const { data, error } = await tasks.update(id, updates);
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
    "Mark a task as done",
    { id: z.string().uuid() },
    async ({ id }) => {
      const { data, error } = await tasks.complete(id);
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
    "Execute bulk task operations described in natural language (e.g., 'archive all done tasks older than 30 days')",
    { instructions: z.string().min(1) },
    async ({ instructions }) => {
      // For now, return the parsed intent. Full NLP implementation in Phase 6.
      return {
        content: [
          {
            type: "text" as const,
            text: `Received organization instructions: "${instructions}"\n\nThis feature will be fully implemented with natural language parsing. For now, use specific tools like update_task or complete_task.`,
          },
        ],
      };
    }
  );
}
