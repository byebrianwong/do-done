import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@do-done/api-client";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { dodoneIcons } from "./icon.js";

/** Protocol identifier — stable, and the form clients key their config on. */
export const SERVER_NAME = "do-done";
/** Display name. The brand is written DoDone everywhere a human reads it. */
export const SERVER_TITLE = "DoDone";
export const SERVER_VERSION = "0.0.1";

/**
 * Sent to the client at initialization, ahead of any tool call.
 *
 * It exists to state the date model once, up front: DoDone schedules on
 * `scheduled_date`, not `deadline_date`, and a client that assumes otherwise
 * will look at a fully planned week and report that nothing is dated. The
 * per-tool descriptions repeat it, but a client that has already decided which
 * tool to call has stopped reading them.
 */
export const SERVER_INSTRUCTIONS = `DoDone task management.

Dates: a task has TWO independent date fields.
- scheduled_date — the day the user plans to DO the task. This is what DoDone
  schedules by, and what the user means by "today", "tomorrow", "this week", or
  by asking what they have on. Nearly every dated task has one.
- deadline_date — a hard external deadline. Rarely set. Its absence does NOT mean a
  task is undated.

Answer "what do I have today / this week / on Friday" with get_agenda, which
covers both fields plus overdue work and resolves the day in the user's own
timezone. get_focus_tasks is an urgency ranking, not a date query — it may
include undated tasks and omit dated ones. Schedule and reschedule tasks by
setting scheduled_date; set deadline_date only for a genuine deadline.

Never state a date relative to your own idea of the current date: every tool
returns the user's real today alongside its results, and relative labels
("today", "in 3 days") are already resolved against it.`;

export interface CreateDoDoneServerOptions {
  supabase: SupabaseClient;
  /** Whose tasks this server instance reads and writes. */
  userId: string;
  /**
   * Public origin of the web app, when the transport knows one. Used only for
   * branding — it lets the server advertise the hosted app icon and link back
   * to the site. The stdio server has no origin and simply omits it.
   */
  baseUrl?: string;
}

/**
 * Build a fully registered do-done MCP server, transport-agnostic.
 *
 * Both entry points share this: the stdio binary in `apps/mcp` and the hosted
 * Streamable HTTP route in `apps/web`. Tools and resources are scoped to a
 * single `userId`, so hosted callers construct one server per authenticated
 * request rather than reusing a process-wide instance.
 */
export function createDoDoneServer({
  supabase,
  userId,
  baseUrl,
}: CreateDoDoneServerOptions): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: SERVER_TITLE,
      version: SERVER_VERSION,
      websiteUrl: baseUrl,
      icons: dodoneIcons(baseUrl),
    },
    { instructions: SERVER_INSTRUCTIONS }
  );

  registerTools(server, supabase, userId);
  registerResources(server, supabase, userId);

  return server;
}

export { dodoneIcons, DODONE_ICON_DATA_URI } from "./icon.js";
export { registerTools } from "./tools/index.js";
export { registerResources } from "./resources/index.js";
export { createClock } from "./clock.js";
export type { Clock, Today } from "./clock.js";
export {
  addDaysISO,
  buildAgenda,
  daysBetweenISO,
  describeTask,
  isOverdueOn,
  relativeDayLabel,
  renderAgenda,
  summarizeTaskDates,
  weekdayName,
  withResolvedDates,
} from "./dates.js";
export type { Agenda, AgendaDay, AgendaEntry, TaskDates } from "./dates.js";
export { executeOrganize } from "./organize.js";
export type { OrganizeResult } from "./organize.js";
