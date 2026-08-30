"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Project } from "@do-done/shared";
import { splitProjects } from "@do-done/shared";
import { openQuickAdd } from "@/lib/quick-add-events";
import { DEMO_BASE, isDemoPath } from "@/lib/demo/mode";
import { NavPendingDot } from "./nav-pending-dot";
import { SortableProjectList } from "./sortable-project-list";

/**
 * Pressed state, shared by every clickable row in the sidebar.
 *
 * This is the cheapest feedback available: it lands on pointer-down, before
 * React, the router or the network are involved. The short, explicit duration
 * matters — Tailwind's default 150ms on a
 * `transition-colors` is tuned for hover, and reads as lag on a press.
 */
const PRESS = "transition-[background-color,color,transform] duration-75 active:scale-[0.985]";

const NAV_ITEMS = [
  {
    label: "Inbox",
    href: "/inbox",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-2.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
        />
      </svg>
    ),
  },
  {
    label: "Today",
    href: "/today",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    ),
  },
  {
    label: "Upcoming",
    href: "/upcoming",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    label: "Calendar",
    href: "/calendar",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 14h.01M13 14h.01M9 18h.01M13 18h.01"
        />
      </svg>
    ),
  },
  {
    label: "All tasks",
    href: "/all",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 6h16M4 12h16M4 18h7"
        />
      </svg>
    ),
  },
  {
    label: "Tags",
    href: "/tags",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 10V5a2 2 0 012-2z"
        />
      </svg>
    ),
  },
  {
    label: "Completed",
    href: "/completed",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/settings",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
];

/**
 * The Places row, kept out of NAV_ITEMS because it is conditional.
 *
 * Same reasoning as the Lists section below: an app whose argument is that a
 * task list should say only what is true of *your* work has no business
 * carrying a permanent link to a feature you have never used. It appears with
 * your first place, and Settings points at the page until then.
 */
const PLACES_ITEM = {
  label: "Places",
  href: "/places",
  icon: (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  ),
};

export function SidebarNav({
  projects = [],
  projectsUnavailable = false,
  hasPlaces = false,
}: {
  projects?: Project[];
  /**
   * Whether `projects` is empty because the read failed rather than because
   * there are none. An empty sidebar is a claim about the user's account, and
   * during an outage it was a false one — the same bug `lib/read-result.ts`
   * fixes on the pages. The layout cannot throw (no boundary wraps it), so it
   * hands the failure here and this section admits it in place.
   */
  projectsUnavailable?: boolean;
  /** Whether the user has any place at all — saved or attached to a task. */
  hasPlaces?: boolean;
}) {
  const pathname = usePathname();
  // One read upstream, two sections here. Shopping lists sit *below* projects
  // and never above: a list is the drawer you open on purpose, not the thing
  // the sidebar greets you with.
  const { projects: workProjects, lists } = splitProjects(projects);
  // The demo runs the whole app under `/demo`, so every nav link has to stay
  // inside it — a bare `/today` would bounce a signed-out visitor to the login
  // wall the demo exists to get around. Derived from the path rather than
  // passed down: the shell that renders this doesn't otherwise care.
  const base = isDemoPath(pathname) ? DEMO_BASE : "";

  return (
    <nav className="flex-1 space-y-0.5 dd-scroll overflow-y-auto px-3 pt-2 pb-4">
      <button
        type="button"
        onClick={() => openQuickAdd()}
        title="New task (q)"
        className={`mb-2 flex w-full items-center gap-3 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-600 active:bg-indigo-700 ${PRESS}`}
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" />
        </svg>
        New task
      </button>
      {NAV_ITEMS.flatMap((item) =>
        // Settings is account-level — connected calendars, timezone, sign-out.
        // There is no account behind the demo, so the page would be a wall of
        // controls that quietly do nothing.
        base && item.href === "/settings"
          ? []
          : // Places slots in after Tags rather than at the end, because it is
            // another way of cutting across the same tasks — not a destination
            // the way Completed and Settings are.
            item.href === "/tags" && hasPlaces
            ? [item, PLACES_ITEM]
            : [item]
      ).map((item) => {
        const href = `${base}${item.href}`;
        const isActive = pathname === href;
        return (
          <Link
            key={item.href}
            href={href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${PRESS} ${
              isActive
                ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 active:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 dark:active:bg-neutral-700"
            }`}
          >
            {item.icon}
            {item.label}
            <NavPendingDot />
          </Link>
        );
      })}

      <div className="mt-6 px-3 py-1">
        <Link
          href={`${base}/projects`}
          className={`text-xs font-semibold uppercase tracking-wider ${
            pathname === `${base}/projects`
              ? "text-indigo-600 dark:text-indigo-400"
              : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          }`}
        >
          Projects
        </Link>
      </div>
      {projectsUnavailable ? (
        // neutral-500, not the neutral-400 the headings above use: those are
        // uppercase labels you skim, this is a sentence the user has to read,
        // and 400 on the light sidebar lands around 2.6:1.
        <p className="px-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          Couldn&rsquo;t load projects
        </p>
      ) : (
        <SortableProjectList projects={workProjects} />
      )}

      {/*
        Lists come out of the same read as projects, so when that read fails
        this section simply renders nothing. That is deliberate: the notice
        above already says the read failed, and repeating it under a second
        heading would be two error messages for one cause.

        The Lists section renders only once there is a list. An empty heading
        would be a permanent advertisement for a feature on every screen of an
        app whose whole argument here is that shopping must not take up room
        when you are looking at your work.

        **Something else must therefore link to `/lists`.** When this shipped,
        nothing did, and the feature was unreachable on every real account: the
        sidebar needed a list to show the link, and the link was needed to make
        the first list. Settings (`ListsSection`) and the command palette both
        carry an unconditional door now, and one of them has to survive any
        future edit to this block.
      */}
      {lists.length > 0 && (
        <>
          <div className="mt-6 px-3 py-1">
            <Link
              href={`${base}/lists`}
              className={`text-xs font-semibold uppercase tracking-wider ${
                pathname === `${base}/lists`
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              }`}
            >
              Lists
            </Link>
          </div>
          <SortableProjectList projects={lists} segment="lists" />
        </>
      )}
    </nav>
  );
}
