// Mock Supabase client used by Storybook (and Chromatic) in place of
// `@/lib/supabase/client`. The real client reads NEXT_PUBLIC_* env vars at
// build time; Storybook is built in CI without those vars, so calling
// `createBrowserClient(undefined, undefined)` throws when any story mounts
// a component that constructs a Supabase client. The Vite alias in
// `.storybook/main.ts` reroutes the import to this file.
//
// The stub is a deep Proxy: any chain (`.from(...).select(...).eq(...)…`)
// returns another proxy, and awaiting any node resolves to
// `{ data: null, error: null }`. The TasksApi normalises null data to []
// or null per method, so stories render with empty content — exactly what
// we want for visual regression snapshots.

// `auth` is the one branch that can't be a bare chainable: callers destructure
// the result (`const { data: { user } } = await supabase.auth.getUser()`), and
// the generic `data: null` blows up on the inner destructure. Hand back a
// signed-in-looking user so components that key writes off the current user id
// take their normal path instead of an error path.
const STUB_USER = { id: "00000000-0000-0000-0000-000000000000" };

const stubAuth = {
  getUser: async () => ({ data: { user: STUB_USER }, error: null }),
  getSession: async () => ({
    data: { session: { user: STUB_USER } },
    error: null,
  }),
  onAuthStateChange: () => ({
    data: { subscription: { unsubscribe() {} } },
  }),
  signOut: async () => ({ error: null }),
};

function makeChainable(): unknown {
  const handler: ProxyHandler<() => unknown> = {
    get(_t, prop) {
      if (prop === "auth") return stubAuth;
      if (prop === "then") {
        return (resolve: (v: { data: null; error: null }) => unknown) =>
          resolve({ data: null, error: null });
      }
      if (prop === "catch" || prop === "finally") return undefined;
      if (prop === Symbol.toPrimitive) return () => "[stub]";
      return makeChainable();
    },
    apply() {
      return makeChainable();
    },
  };
  return new Proxy(() => {}, handler);
}

export function createClientSupabase() {
  return makeChainable() as ReturnType<
    typeof import("@supabase/ssr").createBrowserClient
  >;
}
