import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import {
  TasksApi,
  ProjectsApi,
  UserPrefsApi,
  LocationsApi,
} from "@do-done/api-client";

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

// ─── Cached current-user id ─────────────────────────────────────────────
// `getUser()` hits the auth server on every call. On the hot path (every list
// load and every task mutation) that round-trip is pure latency. Keep the id
// in a module-level cache, primed from the local session and kept fresh by the
// auth-state listener, so getTasksApi()/getProjectsApi() resolve without a
// network hop once the session is known.
let cachedUserId: string | undefined;

if (isClient) {
  void supabase.auth
    .getSession()
    .then(({ data }) => {
      cachedUserId = data.session?.user?.id;
    })
    .catch(() => {
      // ignore — getUserId() falls back to a local getSession() read
    });
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedUserId = session?.user?.id;
  });
}

async function getUserId(): Promise<string | undefined> {
  if (cachedUserId) return cachedUserId;
  // Cold cache (e.g. first call before the listener primes it): read the
  // session from local storage — still no network, unlike getUser().
  const { data } = await supabase.auth.getSession();
  cachedUserId = data.session?.user?.id;
  return cachedUserId;
}

// Memoize the API instances per user so callers don't allocate a new client on
// every tap. Rebuilt only when the signed-in user changes.
let tasksApi: TasksApi | undefined;
let tasksApiUserId: string | undefined;
let projectsApi: ProjectsApi | undefined;
let projectsApiUserId: string | undefined;

export async function getTasksApi(): Promise<TasksApi> {
  const userId = await getUserId();
  if (!tasksApi || tasksApiUserId !== userId) {
    tasksApi = new TasksApi(supabase, userId);
    tasksApiUserId = userId;
  }
  return tasksApi;
}

export async function getProjectsApi(): Promise<ProjectsApi> {
  const userId = await getUserId();
  if (!projectsApi || projectsApiUserId !== userId) {
    projectsApi = new ProjectsApi(supabase, userId);
    projectsApiUserId = userId;
  }
  return projectsApi;
}

let locationsApi: LocationsApi | undefined;
let locationsApiUserId: string | undefined;

export async function getLocationsApi(): Promise<LocationsApi> {
  const userId = await getUserId();
  if (!locationsApi || locationsApiUserId !== userId) {
    locationsApi = new LocationsApi(supabase, userId);
    locationsApiUserId = userId;
  }
  return locationsApi;
}

let userPrefsApi: UserPrefsApi | undefined;
let userPrefsApiUserId: string | undefined;

export async function getUserPrefsApi(): Promise<UserPrefsApi> {
  const userId = await getUserId();
  if (!userPrefsApi || userPrefsApiUserId !== userId) {
    userPrefsApi = new UserPrefsApi(supabase, userId);
    userPrefsApiUserId = userId;
  }
  return userPrefsApi;
}
