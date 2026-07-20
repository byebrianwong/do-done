import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@do-done/api-client";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";

export const SERVER_NAME = "do-done";
export const SERVER_VERSION = "0.0.1";

export interface CreateDoDoneServerOptions {
  supabase: SupabaseClient;
  /** Whose tasks this server instance reads and writes. */
  userId: string;
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
}: CreateDoDoneServerOptions): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerTools(server, supabase, userId);
  registerResources(server, supabase, userId);

  return server;
}

export { registerTools } from "./tools/index.js";
export { registerResources } from "./resources/index.js";
export { executeOrganize } from "./organize.js";
export type { OrganizeResult } from "./organize.js";
