import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createServiceClient(
  url: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

export function createAnonClient(
  url: string,
  anonKey: string
): SupabaseClient {
  return createClient(url, anonKey);
}

export type { SupabaseClient };
