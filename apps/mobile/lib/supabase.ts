import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { TasksApi, ProjectsApi } from "@do-done/api-client";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function getTasksApi() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new TasksApi(supabase, user?.id);
}

export async function getProjectsApi() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new ProjectsApi(supabase, user?.id);
}
