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
  const server = new McpServer({
    name: SERVER_NAME,
    title: SERVER_TITLE,
    version: SERVER_VERSION,
    websiteUrl: baseUrl,
    icons: dodoneIcons(baseUrl),
  });

  registerTools(server, supabase, userId);
  registerResources(server, supabase, userId);

  return server;
}

export { dodoneIcons, DODONE_ICON_DATA_URI } from "./icon.js";
export { registerTools } from "./tools/index.js";
export { registerResources } from "./resources/index.js";
export { executeOrganize } from "./organize.js";
export type { OrganizeResult } from "./organize.js";
