"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth-card";

/**
 * Where to land after signing in. Defaults to /inbox, but the OAuth consent
 * flow sends users here mid-authorization and needs them back on the exact
 * /oauth/authorize URL they came from. Only same-origin relative paths are
 * honoured — an absolute URL here would make this an open redirector.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/inbox";
  if (!raw.startsWith("/")) return "/inbox";
  // "//host" and "/\host" are both protocol-relative to a browser — the second
  // spelling is the one a naive `startsWith("//")` check misses.
  if (raw[1] === "/" || raw[1] === "\\") return "/inbox";
  return raw;
}

/**
 * `useSearchParams()` opts a component out of static prerendering, so the form
 * lives in its own component behind a Suspense boundary — otherwise the whole
 * /login route fails to build. Only this inner piece needs the query string.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

function LoginFallback() {
  return (
    <Shell>
      <div className="text-center">
        <h1 className="mb-2 text-4xl font-bold text-indigo-500">DoDone</h1>
      </div>
    </Shell>
  );
}

function LoginForm() {
  const next = safeNext(useSearchParams().get("next"));

  return (
    <Shell>
      <div className="mb-10 text-center">
        <Link href="/" className="text-4xl font-bold text-indigo-500">
          DoDone
        </Link>
        <p className="mt-2 text-sm text-neutral-500">Welcome back</p>
      </div>

      <AuthCard next={next} />

      <p className="mt-6 text-center text-xs text-neutral-500">
        Just looking?{" "}
        <Link
          href="/demo"
          className="font-medium text-indigo-500 hover:text-indigo-600"
        >
          Try the live demo
        </Link>{" "}
        — no account needed.
      </p>
    </Shell>
  );
}
