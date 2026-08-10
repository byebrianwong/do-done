import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { QuickAddModal } from "@/components/quick-add-modal";
import { UndoToastProvider } from "@/components/undo-toast";
import { CompletionStreakProvider } from "@/lib/completion-streak";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { TaskEditorProvider } from "@/components/task-editor-provider";
import { StatusSyncRunner } from "@/components/status-sync-runner";
import { TaskSelectionProvider } from "@/lib/task-selection";
import { TaskEditingHoldProvider } from "@/lib/task-editing-hold";
import { QuickAddProvider } from "@/lib/quick-add-context";
import { SuggestionProvider } from "@/lib/suggestions";
import { createServerSupabase } from "@/lib/supabase/server";
import { PIP_HIDDEN_COOKIE } from "@/lib/pip-visibility";
import { ProjectsApi } from "@do-done/api-client";
import type { Project } from "@do-done/shared";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const cookieStore = await cookies();
  const pipHidden = cookieStore.get(PIP_HIDDEN_COOKIE)?.value === "1";

  let projects: Project[] = [];
  if (user) {
    const projectsApi = new ProjectsApi(supabase, user.id);
    const result = await projectsApi.list();
    projects = result.data;
  }

  return (
    // One fetch of the recent completion history for the whole app, so a row
    // can ask "does this keep my streak alive?" without a round-trip on the
    // frame of the tap.
    <CompletionStreakProvider>
      <UndoToastProvider>
        <TaskSelectionProvider>
          <TaskEditingHoldProvider>
            <QuickAddProvider projects={projects} userId={user?.id ?? null}>
              {/* One count of the task history for every quick-add surface, so
                the chips can guess a project without a round-trip per keystroke. */}
              <SuggestionProvider>
                {/* Owns the task editor for the whole app, and mirrors it onto
                  the URL — so an open task always has a link to share. */}
                <TaskEditorProvider>
                  <AppShell
                    projects={projects}
                    userEmail={user?.email ?? null}
                    pipHidden={pipHidden}
                  >
                    {children}
                  </AppShell>
                  <CommandPalette projects={projects} />
                  <QuickAddModal projects={projects} userId={user?.id ?? null} />
                </TaskEditorProvider>
              </SuggestionProvider>
            </QuickAddProvider>
          </TaskEditingHoldProvider>
          <BulkActionBar projects={projects} />
          <StatusSyncRunner />
        </TaskSelectionProvider>
      </UndoToastProvider>
    </CompletionStreakProvider>
  );
}
