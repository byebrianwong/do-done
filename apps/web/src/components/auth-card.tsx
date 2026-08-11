"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientSupabase } from "@/lib/supabase/client";

/**
 * Sign in / sign up, in a card.
 *
 * Lives here rather than on the login page because the landing page shows the
 * same form — a visitor who already has an account shouldn't have to go
 * looking for a second page to use it. `next` is passed in: the login route
 * carries a destination through the auth proxy, the landing page just wants
 * the inbox.
 */
export function AuthCard({
  next = "/inbox",
  compact = false,
}: {
  /** Where to land after signing in. Callers must have validated it. */
  next?: string;
  /** Trims the padding for the landing page, where the card sits in a column. */
  compact?: boolean;
}) {
  const router = useRouter();
  const supabase = createClientSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  /** Signing up succeeds without signing you in, so it needs somewhere to say
   *  so that isn't the red box the failures use. */
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              // The confirmation link must come back to /auth/callback, the
              // only route that exchanges the code for a session. Unset,
              // Supabase falls back to the project's Site URL, which lands a
              // brand-new account on the landing page with an unspent code in
              // the query string and no session — signup silently does
              // nothing. The origin has to be allow-listed in the project's
              // redirect URLs or Supabase quietly falls back anyway.
              emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
            },
          });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (mode === "signup") {
      setNotice("Check your email for a link to confirm your address.");
      return;
    }

    router.push(next);
    router.refresh();
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${
        compact ? "p-6" : "p-8"
      }`}
    >
      <button
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-neutral-300 px-4 py-2.5 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        <span className="text-sm font-medium">Continue with Google</span>
      </button>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        <span className="text-xs text-neutral-400">or</span>
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
      </div>

      <form onSubmit={handleEmailAuth} className="space-y-4">
        <div>
          <label
            htmlFor="auth-email"
            className="mb-1.5 block text-xs font-medium text-neutral-700 dark:text-neutral-300"
          >
            Email
          </label>
          {/* `name` + `autocomplete` are what password managers key off to
              recognise this as a login form and to save the pair as one
              credential. Without them 1Password et al. see two anonymous
              inputs. */}
          <input
            id="auth-email"
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>
        <div>
          <label
            htmlFor="auth-password"
            className="mb-1.5 block text-xs font-medium text-neutral-700 dark:text-neutral-300"
          >
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            name="password"
            // Signup asks for a *new* password, so managers offer to generate
            // and save rather than fill the existing one.
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-500 dark:bg-red-950/50">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
            {notice}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50"
        >
          {loading ? "..." : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-neutral-500">
        {mode === "signin" ? "New to DoDone?" : "Have an account?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
          className="font-medium text-indigo-500 hover:text-indigo-600"
        >
          {mode === "signin" ? "Sign up" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
