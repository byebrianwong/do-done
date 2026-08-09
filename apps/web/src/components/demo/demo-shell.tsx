"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { QuickAddModal } from "@/components/quick-add-modal";
import { UndoToastProvider } from "@/components/undo-toast";
import { CompletionStreakProvider } from "@/lib/completion-streak";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { TaskEditorProvider } from "@/components/task-editor-provider";
import { TaskSelectionProvider } from "@/lib/task-selection";
import { TaskEditingHoldProvider } from "@/lib/task-editing-hold";
import { QuickAddProvider } from "@/lib/quick-add-context";
import { DEMO_USER_ID } from "@/lib/demo/mode";
import { resetDemoStore } from "@/lib/demo/store";
import { useDemoData } from "@/lib/demo/use-demo-data";

/**
 * The demo's answer to `(app)/layout.tsx`: the same provider stack, over the
 * sandbox instead of Supabase.
 *
 * `userEmail` is null on purpose. It's what AppShell keys the account footer
 * and the Pip panel off, and both want a real signed-in user — the footer to
 * sign out of, and Pip to read its state from the database. The demo supplies
 * its own footer in their place.
 */
export function DemoShell({ children }: { children: React.ReactNode }) {
  const { projects } = useDemoData();

  return (
    // The demo is the app, so the streak rule has to work here too — against
    // the sandbox's own completion history.
    <CompletionStreakProvider>
      <UndoToastProvider>
        <TaskSelectionProvider>
          <TaskEditingHoldProvider>
            <QuickAddProvider projects={projects} userId={DEMO_USER_ID}>
              <TaskEditorProvider>
                <AppShell
                  projects={projects}
                  userEmail={null}
                  sidebarFooter={<DemoSidebarFooter />}
                >
                  {children}
                </AppShell>
                <CommandPalette projects={projects} />
                <QuickAddModal projects={projects} userId={DEMO_USER_ID} />
              </TaskEditorProvider>
            </QuickAddProvider>
          </TaskEditingHoldProvider>
          <BulkActionBar projects={projects} />
        </TaskSelectionProvider>
      </UndoToastProvider>
    </CompletionStreakProvider>
  );
}

/**
 * Where the account card sits in the real app. Says plainly that nothing here
 * is saved, offers a clean slate, and points at the way out.
 */
function DemoSidebarFooter() {
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/40">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex h-4 items-center rounded bg-indigo-500 px-1.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Demo
        </span>
        <span className="text-xs font-medium text-indigo-900 dark:text-indigo-200">
          Sample data
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-indigo-900/70 dark:text-indigo-200/70">
        Everything works — edit, drag, complete. Nothing is saved, and only you
        can see it.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <Link
          href="/#get-started"
          className="flex-1 rounded-lg bg-indigo-500 px-2.5 py-1.5 text-center text-xs font-semibold text-white transition-colors hover:bg-indigo-600"
        >
          Get your own
        </Link>
        <button
          type="button"
          onClick={() => resetDemoStore()}
          title="Restore the sample data"
          className="rounded-lg border border-indigo-200 px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-white dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
