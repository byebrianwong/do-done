import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@do-done/api-client";
import { TasksApi, ProjectsApi } from "@do-done/api-client";

export function registerResources(
  server: McpServer,
  supabase: SupabaseClient,
  userId: string
) {
  const tasks = new TasksApi(supabase, userId);
  const projects = new ProjectsApi(supabase, userId);

  server.resource("inbox", "tasks://inbox", async (uri) => {
    const { data, error } = await tasks.getInbox();
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

  server.resource("today", "tasks://today", async (uri) => {
    const { data, error } = await tasks.getToday();
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

  server.resource("upcoming", "tasks://upcoming", async (uri) => {
    const { data, error } = await tasks.getUpcoming(7);
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
