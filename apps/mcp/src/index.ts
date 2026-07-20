#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServiceClient } from "@do-done/api-client";
import { createDoDoneServer } from "@do-done/mcp-server";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID = process.env.DO_DONE_USER_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !USER_ID) {
  console.error(
    "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DO_DONE_USER_ID"
  );
  process.exit(1);
}

const server = createDoDoneServer({
  supabase: createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
  userId: USER_ID,
});

const transport = new StdioServerTransport();
await server.connect(transport);
