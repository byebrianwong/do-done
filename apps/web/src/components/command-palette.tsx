"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PRIORITY_CONFIG } from "@do-done/shared";
import type { Project, Task } from "@do-done/shared";
import { TasksApi } from "@do-done/api-client";
import { createClientSupabase } from "@/lib/supabase/client";

type CommandKind = "nav" | "project" | "task" | "action";

interface Command {
  id: string;
  kind: CommandKind;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  href?: string;
  onRun?: () => void | Promise<void>;
  color?: string;
}

const NAV_COMMANDS: Command[] = [
  {
    id: "nav-inbox",
    kind: "nav",
    title: "Inbox",
    subtitle: "Go to inbox",
    href: "/inbox",
    icon: <NavIcon path="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-2.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />,
  },
  {
    id: "nav-today",
    kind: "nav",
    title: "Today",
    subtitle: "Today's focus + tasks",
    href: "/today",
    icon: <NavIcon path="M13 10V3L4 14h7v7l9-11h-7z" />,
  },
  {
    id: "nav-upcoming",
    kind: "nav",
    title: "Upcoming",
    subtitle: "Next 7 days",
    href: "/upcoming",
    icon: <NavIcon path="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
  },
  {
    id: "nav-calendar",
    kind: "nav",
    title: "Calendar",
    subtitle: "Week view",
    href: "/calendar",
    icon: <NavIcon path="M9 14h.01M13 14h.01M9 18h.01M13 18h.01M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
  },
  {
    id: "nav-projects",
    kind: "nav",
    title: "Projects",
    subtitle: "All projects",
    href: "/projects",
    icon: <NavIcon path="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />,
  },
  {
    id: "nav-settings",
    kind: "nav",
    title: "Settings",
    href: "/settings",
    icon: <NavIcon path="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />,
  },
];

function NavIcon({ path }: { path: string }) {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

export function CommandPalette({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [taskResults, setTaskResults] = useState<Task[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl+K toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced task search
  useEffect(() => {
    if (!open || !query.trim()) {
      setTaskResults([]);
      return;
    }
    const q = query.trim();
    let cancelled = false;
    setSearching(true);
    const timeout = setTimeout(async () => {
      const supabase = createClientSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const tasks = new TasksApi(supabase, user.id);
      const { data } = await tasks.search(q);
      if (!cancelled) {
        setTaskResults(data.slice(0, 8));
        setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      setSearching(false);
    };
  }, [open, query]);

  const projectCommands: Command[] = useMemo(
    () =>
      projects.map((p) => ({
        id: `project-${p.id}`,
        kind: "project",
        title: `${p.icon ? `${p.icon} ` : ""}${p.name}`,
        subtitle: "Open project",
        href: `/projects/${p.id}`,
        color: p.color,
      })),
    [projects]
  );

  const taskCommands: Command[] = useMemo(
    () =>
      taskResults.map((t) => ({
        id: `task-${t.id}`,
        kind: "task",
        title: t.title,
        subtitle:
          t.due_date
            ? `Due ${t.due_date}${t.due_time ? ` ${t.due_time}` : ""}`
            : t.status,
        color: PRIORITY_CONFIG[t.priority].color,
        href: t.project_id ? `/projects/${t.project_id}` : "/inbox",
      })),
    [taskResults]
  );

  const actionCommands: Command[] = useMemo(
    () => [
      {
        id: "action-new-project",
        kind: "action",
        title: "New project",
        subtitle: "Create a project",
        onRun: () => {
          router.push("/projects");
          setTimeout(() => {
            window.dispatchEvent(new Event("do-done:open-new-project"));
          }, 100);
        },
        icon: <NavIcon path="M12 4v16m8-8H4" />,
      },
      {
        id: "action-sync-cal",
        kind: "action",
        title: "Sync Google Calendar",
        subtitle: "Push tasks + pull changes",
        onRun: async () => {
          await fetch("/api/calendar/sync", { method: "POST" });
          router.refresh();
        },
        icon: (
          <NavIcon path="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        ),
      },
    ],
    [router]
  );

  // Build the visible command list, filtered by query
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filterCmds = (cmds: Command[]) =>
      q
        ? cmds.filter(
            (c) =>
              c.title.toLowerCase().includes(q) ||
              (c.subtitle?.toLowerCase().includes(q) ?? false)
          )
        : cmds;

    return [
      { label: "Tasks", commands: taskCommands }, // already filtered server-side
      { label: "Navigation", commands: filterCmds(NAV_COMMANDS) },
      { label: "Projects", commands: filterCmds(projectCommands) },
      { label: "Actions", commands: filterCmds(actionCommands) },
    ].filter((s) => s.commands.length > 0);
  }, [query, taskCommands, projectCommands, actionCommands]);

  const flatCommands = useMemo(
    () => sections.flatMap((s) => s.commands),
    [sections]
  );

  // Keep activeIndex in bounds
  useEffect(() => {
    if (activeIndex >= flatCommands.length) {
      setActiveIndex(Math.max(0, flatCommands.length - 1));
    }
  }, [flatCommands.length, activeIndex]);

  function runCommand(cmd: Command) {
    setOpen(false);
    if (cmd.href) {
      router.push(cmd.href);
    }
    if (cmd.onRun) {
      void cmd.onRun();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatCommands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = flatCommands[activeIndex];
      if (cmd) runCommand(cmd);
    }
  }

  if (!open) return null;

  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <svg
            className="h-4 w-4 text-neutral-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, navigate, run actions..."
            className="flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
          />
          <kbd className="hidden rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 sm:inline">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1">
          {searching && (
            <div className="px-3 py-3 text-xs text-neutral-400">Searching...</div>
          )}
          {!searching && flatCommands.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-neutral-400">
              No matches.
            </div>
          )}
          {sections.map((section) => (
            <div key={section.label}>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                {section.label}
              </div>
              {section.commands.map((cmd) => {
                const idx = runningIndex++;
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={cmd.id}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => runCommand(cmd)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100"
                        : "text-neutral-700 dark:text-neutral-300"
                    }`}
                  >
                    {cmd.icon ? (
                      <span className="text-neutral-500">{cmd.icon}</span>
                    ) : cmd.color ? (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: cmd.color }}
                      />
                    ) : (
                      <span className="w-4" />
                    )}
                    <span className="flex-1 truncate">{cmd.title}</span>
                    {cmd.subtitle && (
                      <span className="truncate text-xs text-neutral-400">
                        {cmd.subtitle}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-4 py-2 text-[10px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex gap-3">
            <span>
              <kbd className="font-mono">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="font-mono">↵</kbd> select
            </span>
          </div>
          <span>
            <kbd className="font-mono">⌘K</kbd> to toggle
          </span>
        </div>
      </div>
    </div>
  );
}
