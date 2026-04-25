import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { TasksApi, ProjectsApi } from "@do-done/api-client";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// During Expo's Node SSR pre-render `window` is undefined and AsyncStorage
// will throw. Use a no-op storage adapter in that environment.
const isClient = typeof window !== "undefined";
const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: isClient ? AsyncStorage : noopStorage,
    autoRefreshToken: isClient,
    persistSession: isClient,
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
