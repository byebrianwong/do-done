import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { AppPreview } from "./app-preview";
import { QuickAddDemo } from "./quick-add-demo";
import { Reveal } from "./reveal";

/**
 * The public front door.
 *
 * Two jobs, in this order: show somebody who has never heard of DoDone what it
 * feels like to use, and let somebody who already has an account get in. The
 * demo link does the first job better than any amount of copy — it's the real
 * app, one click away, with a week of tasks already in it — so it's the
 * primary call to action everywhere on the page, and the sign-in form sits
 * where a returning user will look for it (the header, and the last section).
 *
 * Everything here is server-rendered except the two animated pieces. No
 * images: the "screenshot" is markup, so it can never go stale, and the page
 * has nothing to download before it's readable.
 */
export function LandingPage({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <Header signedIn={signedIn} />
      <Hero signedIn={signedIn} />
      <Capabilities />
      <QuickAddSection />
      <ClaudeSection />
      <FeatureGrid />
      <Everywhere />
      <GetStarted signedIn={signedIn} />
      <Footer />
    </div>
  );
}

/* ── Chrome ─────────────────────────────────────────────────────────── */

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500">
        <svg
          className="h-4 w-4 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
        DoDone
      </span>
    </span>
  );
}

function Header({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/70 bg-white/80 backdrop-blur-md dark:border-neutral-800/70 dark:bg-neutral-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
        <Link href="/" aria-label="DoDone home">
          <Wordmark />
        </Link>

        <nav className="ml-6 hidden items-center gap-6 md:flex">
          <a
            href="#features"
            className="text-sm text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Features
          </a>
          <a
            href="#claude"
            className="text-sm text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            With Claude
          </a>
          <Link
            href="/demo"
            className="text-sm text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Demo
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {signedIn ? (
            <Link
              href="/today"
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-600"
            >
              Open DoDone
            </Link>
          ) : (
            <>
              <a
                href="#get-started"
                className="hidden rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 sm:block dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              >
                Sign in
              </a>
              <Link
                href="/demo"
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-600"
              >
                Check it out
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ── Hero ───────────────────────────────────────────────────────────── */

function Hero({ signedIn }: { signedIn: boolean }) {
  // `isolate` on the section is required: it makes the hero its own
  // stacking context, so the aurora's `-z-10` stays behind the hero's *content*
  // instead of escaping to the root and painting behind the page's own white
  // background, where it is invisible.
  return (
    <section className="relative isolate overflow-hidden px-5 pt-16 pb-20 sm:pt-24">
      {/* Ambient colour. `pointer-events-none` and aria-hidden — it's paint,
          and it must never be in front of the CTAs underneath it. */}
      {/* Bounded to the top of the section, not `inset-0`: at this blur radius
          a full-height container tints the entire hero lavender and the
          headline loses its contrast. It's a halo behind the first screenful,
          faded out along the bottom edge so there's no seam where it stops. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[30rem] overflow-hidden"
        aria-hidden
      >
        <div className="dd-aurora-a absolute -top-56 left-1/2 h-[26rem] w-[36rem] -translate-x-[80%] rounded-full bg-indigo-400/25 blur-[100px] dark:bg-indigo-600/25" />
        <div className="dd-aurora-b absolute -top-52 left-1/2 h-[22rem] w-[32rem] -translate-x-[10%] rounded-full bg-violet-400/20 blur-[100px] dark:bg-violet-700/25" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-300/50 to-transparent dark:via-indigo-700/50" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-white dark:to-neutral-950" />
      </div>

      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50/70 py-1 pr-3 pl-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300 dark:hover:bg-indigo-950"
          >
            <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              New
            </span>
            Play with the whole app — no sign-up
            <span aria-hidden>→</span>
          </Link>
        </Reveal>

        <Reveal delayMs={60}>
          <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-neutral-900 sm:text-6xl dark:text-neutral-50">
            Plan your day,
            <br />
            <span className="bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500 bg-clip-text text-transparent">
              not just your list.
            </span>
          </h1>
        </Reveal>

        <Reveal delayMs={120}>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-neutral-600 sm:text-lg dark:text-neutral-400">
            Type a task the way you’d say it out loud. DoDone works out the
            when, keeps hard deadlines separate from the day you plan to do the
            work, and hands you a Today you can actually finish.
          </p>
        </Reveal>

        <Reveal delayMs={180}>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/demo"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:-translate-y-0.5 hover:bg-indigo-600 hover:shadow-xl hover:shadow-indigo-500/30 sm:w-auto"
            >
              Check it out
              <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
            </Link>
            <a
              href={signedIn ? "/today" : "#get-started"}
              className="inline-flex w-full items-center justify-center rounded-xl border border-neutral-300 px-7 py-3.5 text-base font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 sm:w-auto dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
            >
              {signedIn ? "Go to your tasks" : "Sign in"}
            </a>
          </div>
        </Reveal>

        <Reveal delayMs={220}>
          <p className="mt-4 text-xs text-neutral-500">
            The demo is the real app with a week of sample tasks in it. Nothing
            is saved, nothing is shared, reset it whenever you like.
          </p>
        </Reveal>
      </div>

      <Reveal delayMs={280}>
        <div className="mx-auto mt-14 max-w-5xl">
          <AppPreview />
        </div>
      </Reveal>
    </section>
  );
}

/* ── Capability strip ───────────────────────────────────────────────── */

const VIEWS = [
  {
    name: "Today",
    body: "Overdue work, then the handful of things worth doing now — with the day's meetings above them, so the gaps are visible.",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    name: "Upcoming",
    body: "The next month as a run of days. Drag a task from one to another; drag an undated one in from the side.",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
  {
    name: "Inbox",
    body: "Somewhere to put a thought at the moment you have it, and sort out later what it actually was.",
    icon: "M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-2.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4",
  },
];

function Capabilities() {
  return (
    <section className="border-y border-neutral-200 bg-neutral-50/60 px-5 py-16 dark:border-neutral-800 dark:bg-neutral-900/30">
      <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
        {VIEWS.map((v, i) => (
          <Reveal key={v.name} delayMs={i * 80}>
            <div>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                <svg
                  className="h-4.5 w-4.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={v.icon} />
                </svg>
              </span>
              <h3 className="mt-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {v.name}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                {v.body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ── Quick add ──────────────────────────────────────────────────────── */

function QuickAddSection() {
  return (
    <section className="px-5 py-20 sm:py-24">
      <div className="mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">
              One line in
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
              Stop filling in forms
            </h2>
            <p className="mt-4 text-base leading-relaxed text-neutral-600 dark:text-neutral-400">
              Dates, estimates, tags, priority and project all come out of the
              sentence as you type it. What the parser picked up shows up as
              chips underneath, so you can see it got you right before you hit
              enter — and change anything it didn’t.
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                "“tomorrow”, “friday 9am”, “/week” — the day you’ll do it",
                "“due friday”, “deadline the 30th” — a hard deadline instead",
                "“~30m” estimates, “p1” prioritises, “#finance” tags",
              ].map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2.5 text-sm text-neutral-700 dark:text-neutral-300"
                >
                  <span className="mt-0.5 text-indigo-500" aria-hidden>
                    ✓
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal delayMs={100}>
          <QuickAddDemo />
        </Reveal>
      </div>
    </section>
  );
}

/* ── Claude / MCP ───────────────────────────────────────────────────── */

function ClaudeSection() {
  return (
    <section
      id="claude"
      className="border-y border-neutral-200 bg-neutral-50/60 px-5 py-20 sm:py-24 dark:border-neutral-800 dark:bg-neutral-900/30"
    >
      <div className="mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-2">
        <Reveal className="lg:order-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">
              Built for AI, properly
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
              Your task list, in the conversation
            </h2>
            <p className="mt-4 text-base leading-relaxed text-neutral-600 dark:text-neutral-400">
              DoDone ships its own MCP server, so Claude can read your agenda,
              add and reschedule tasks, and tell you what’s actually urgent —
              in Claude Desktop, in Claude Code, or as a connector on
              claude.ai.
            </p>
            <p className="mt-4 text-base leading-relaxed text-neutral-600 dark:text-neutral-400">
              It answers date questions from the day you planned to do the
              work, resolved in your own timezone — not from a deadline field
              you almost never set. Ask what your week looks like and you get
              your week.
            </p>
          </div>
        </Reveal>

        <Reveal delayMs={100} className="lg:order-1">
          <ChatMock />
        </Reveal>
      </div>
    </section>
  );
}

function ChatMock() {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
          Claude · DoDone connector
        </span>
      </div>
      <div className="space-y-4 p-4">
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-500 px-3.5 py-2 text-[13px] text-white">
            What have I got on today?
          </p>
        </div>

        <div className="max-w-[92%] space-y-2.5">
          <div className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 font-mono text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path strokeLinecap="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            get_agenda
          </div>
          <p className="text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300">
            Six things, and one of them is late.
          </p>
          <ul className="space-y-1.5 text-[13px] text-neutral-700 dark:text-neutral-300">
            <li className="flex gap-2">
              <span className="text-red-500" aria-hidden>
                •
              </span>
              <span>
                <strong className="font-medium">Q3 numbers to Priya</strong> —
                two days overdue, 30 min. Do this first.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-500" aria-hidden>
                •
              </span>
              <span>
                <strong className="font-medium">Launch announcement</strong> —
                9:30, 90 min, already in progress.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-neutral-400" aria-hidden>
                •
              </span>
              <span>Design review 2pm, run at 6, plus two small ones.</span>
            </li>
          </ul>
          <p className="text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300">
            Your only free stretch is 9:45–11:00. Want me to move the run to
            tomorrow and put the announcement there?
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Features ───────────────────────────────────────────────────────── */

const FEATURES = [
  {
    title: "Scheduled ≠ deadline",
    body: "The day you plan to do something and the day it’s actually needed are two different facts. DoDone stores both, and plans by the first.",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
  {
    title: "A Today that curates itself",
    body: "Overdue first, then what’s urgent — and you can pin anything in or push it out by dragging. Your override sticks.",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    title: "Two-way calendar sync",
    body: "Scheduled tasks appear in Google Calendar, and your meetings appear in DoDone. Move one and the other follows.",
    icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  },
  {
    title: "Drag anything anywhere",
    body: "Reorder a list, drop a task on another day, move it between projects. It saves as you let go.",
    icon: "M4 8h16M4 16h16",
  },
  {
    title: "Sort, group, filter — per view",
    body: "Group Today by project and Upcoming by date, and it stays that way, on every device you sign in from.",
    icon: "M3 4h18M7 12h10M11 20h2",
  },
  {
    title: "Keyboard first",
    body: "⌘K opens the palette, Q adds a task from anywhere, and the whole thing is navigable without reaching for the mouse.",
    icon: "M9 7h6m-6 4h6m-6 4h2m-5 5h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
];

function FeatureGrid() {
  return (
    <section id="features" className="px-5 py-20 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <Reveal>
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">
              The details
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
              Small decisions, made carefully
            </h2>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delayMs={(i % 3) * 80}>
              <div>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d={f.icon}
                    />
                  </svg>
                </span>
                <h3 className="mt-3.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                  {f.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Everywhere ─────────────────────────────────────────────────────── */

const SURFACES = [
  {
    name: "Web",
    body: "The full app, keyboard-driven, in any browser.",
    icon: "M21 12a9 9 0 11-18 0 9 9 0 0118 0zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18 15 15 0 010-18z",
  },
  {
    name: "Phone",
    body: "Quick capture from a home-screen widget or a launcher shortcut, plus reminders when you arrive somewhere.",
    icon: "M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z",
  },
  {
    name: "Claude",
    body: "An MCP connector that can read and change your plan in conversation.",
    icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  },
];

function Everywhere() {
  return (
    <section className="border-y border-neutral-200 bg-neutral-50/60 px-5 py-16 dark:border-neutral-800 dark:bg-neutral-900/30">
      <div className="mx-auto max-w-5xl">
        <Reveal>
          <h2 className="text-center text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl dark:text-neutral-50">
            Wherever you think of it
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {SURFACES.map((s, i) => (
            // `h-full` on both the reveal wrapper and the card: the wrapper is
            // the grid item, so without it the card only ever grows to its own
            // content and a three-line card sits taller than its neighbours.
            <Reveal key={s.name} delayMs={i * 80} className="h-full">
              <div className="h-full rounded-2xl border border-neutral-200 bg-white p-5 text-center dark:border-neutral-800 dark:bg-neutral-900">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d={s.icon}
                    />
                  </svg>
                </span>
                <h3 className="mt-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {s.name}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                  {s.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Get started ────────────────────────────────────────────────────── */

function GetStarted({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="get-started" className="scroll-mt-20 px-5 py-20 sm:py-24">
      <div className="mx-auto grid max-w-4xl items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
              {signedIn ? "Welcome back" : "Start with the demo"}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-neutral-600 dark:text-neutral-400">
              {signedIn
                ? "You’re signed in — your tasks are one click away."
                : "It’s the whole app, already full of tasks. Complete things, drag them around, open the editor, break it if you like — it’s yours alone and a reset button puts it back."}
            </p>

            <Link
              href={signedIn ? "/today" : "/demo"}
              className="group mt-7 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:-translate-y-0.5 hover:bg-indigo-600"
            >
              {signedIn ? "Go to your tasks" : "Open the live demo"}
              <span
                className="transition-transform group-hover:translate-x-0.5"
                aria-hidden
              >
                →
              </span>
            </Link>

            {signedIn ? null : (
              <p className="mt-4 text-xs text-neutral-500">
                No account, no email, no cookie banner.
              </p>
            )}
          </div>
        </Reveal>

        {signedIn ? null : (
          <Reveal delayMs={100}>
            <div>
              <h3 className="mb-4 text-center text-sm font-semibold text-neutral-500 dark:text-neutral-400">
                Or sign in to your own
              </h3>
              <AuthCard compact />
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-neutral-200 px-5 py-10 dark:border-neutral-800">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
        <Wordmark />
        <div className="flex items-center gap-6 text-sm text-neutral-500">
          <Link href="/demo" className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-200">
            Demo
          </Link>
          <a href="#features" className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-200">
            Features
          </a>
          <Link href="/login" className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-200">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
