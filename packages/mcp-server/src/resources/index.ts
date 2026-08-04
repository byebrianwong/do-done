import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@do-done/api-client";
import { TasksApi, ProjectsApi } from "@do-done/api-client";
import type { Task } from "@do-done/shared";
import { createClock } from "../clock.js";
import { addDaysISO, withResolvedDates } from "../dates.js";

const UPCOMING_DAYS = 7;

export function registerResources(
  server: McpServer,
  supabase: SupabaseClient,
  userId: string
) {
  const tasks = new TasksApi(supabase, userId);
  const projects = new ProjectsApi(supabase, userId);
  const clock = createClock(supabase, userId);

  /**
   * Wrap a task list in the same envelope the tools use: the day it was
   * resolved against, the timezone that day came from, and per-task relative
   * dates. A bare array of rows leaves the reader to work out whether
   * `when_date: "2026-08-03"` is today, which is the whole problem.
   */
  const envelope = async (
    load: (todayISO: string) => Promise<{ data: Task[]; error: Error | null }>
  ) => {
    const { todayISO, timezone } = await clock.now();
    const { data, error } = await load(todayISO);
    if (error) return { error: error.message };
    return {
      today: todayISO,
      timezone,
      count: data.length,
      tasks: data.map((task) => withResolvedDates(task, todayISO)),
    };
  };

  /** Dedupe by id — the today resource unions two overlapping queries. */
  const unique = (lists: Task[][]): Task[] => {
    const byId = new Map<string, Task>();
    for (const list of lists) for (const task of list) byId.set(task.id, task);
    return [...byId.values()];
  };

  server.resource("inbox", "tasks://inbox", async (uri) => {
    const body = await envelope(() => tasks.getInbox());
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(body, null, 2),
        },
      ],
    };
  });

  // Today = overdue plus everything dated today, resolved in the user's
  // timezone rather than the server's. `TasksApi.getToday()` derives the day
  // from the process clock, which is UTC on the hosted transport and so lands
  // on the wrong day for a user in another zone.
  server.resource("today", "tasks://today", async (uri) => {
    const body = await envelope(async (todayISO) => {
      const [overdue, today] = await Promise.all([
        tasks.getOverdue(todayISO),
        tasks.getDatedBetween(todayISO, todayISO),
      ]);
      const error = overdue.error ?? today.error;
      if (error) return { data: [], error };
      return { data: unique([overdue.data, today.data]), error: null };
    });
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(body, null, 2),
        },
      ],
    };
  });

  // Upcoming excludes today itself — today's work lives in tasks://today, and
  // repeating it here made the two resources disagree about what "upcoming"
  // meant. Starts tomorrow, runs UPCOMING_DAYS days.
  server.resource("upcoming", "tasks://upcoming", async (uri) => {
    const body = await envelope((todayISO) =>
      tasks.getDatedBetween(
        addDaysISO(todayISO, 1),
        addDaysISO(todayISO, UPCOMING_DAYS)
      )
    );
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(body, null, 2),
        },
      ],
    };
  });

  server.resource("projects", "tasks://projects", async (uri) => {
    const { data, error } = await projects.list();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            error ? { error: error.message } : data,
            null,
            2
          ),
        },
      ],
    };
  });
}
