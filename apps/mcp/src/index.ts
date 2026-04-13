#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServiceClient } from "@do-done/api-client";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID = process.env.DO_DONE_USER_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !USER_ID) {
  console.error(
    "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DO_DONE_USER_ID"
  );
  process.exit(1);
}

const server = new McpServer({
  name: "do-done",
  version: "0.0.1",
});

const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

registerTools(server, supabase, USER_ID);
registerResources(server, supabase, USER_ID);

const transport = new StdioServerTransport();
await server.connect(transport);
