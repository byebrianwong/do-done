import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { QuickAddModal } from "@/components/quick-add-modal";
import { UndoToastProvider } from "@/components/undo-toast";
import { CompletionStreakProvider } from "@/lib/completion-streak";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { TaskEditorProvider } from "@/components/task-editor-provider";
import { StatusSyncRunner } from "@/components/status-sync-runner";
import { AutoSyncToasts } from "@/lib/auto-sync-events";
import { TaskSelectionProvider } from "@/lib/task-selection";
import { TaskEditingHoldProvider } from "@/lib/task-editing-hold";
import { QuickAddProvider } from "@/lib/quick-add-context";
import { SuggestionProvider } from "@/lib/suggestions";
import { TaskLocationsProvider } from "@/lib/task-locations-context";
import { createServerSupabase } from "@/lib/supabase/server";
import { PIP_HIDDEN_COOKIE } from "@/lib/pip-visibility";
import { LocationsApi, ProjectsApi } from "@do-done/api-client";
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
  // Whether the sidebar's project list is empty because there is nothing to
  // show, or because we could not find out. `lib/read-result.ts` makes a page
  // throw on that distinction; this layout must NOT — a throw here is caught
  // by no boundary of ours (Next's `error.tsx` does not wrap the layout in its
  // own segment) and would take the whole shell down, including the error card
  // the page is trying to render inside it. So the failure is carried down to
  // the one section that can admit it in place.
  let projectsUnavailable = false;
  // Whether to offer the Places view at all. `listAll` rather than `list`: a
  // place attached inline to a task is never "saved", and hiding the nav from
  // someone who has three reminders running would be the one case that
  // matters. It is a narrow read of a table most accounts have nothing in.
  let hasPlaces = false;
  if (user) {
    const projectsApi = new ProjectsApi(supabase, user.id);
    const locationsApi = new LocationsApi(supabase, user.id);
    const [projectResult, locationResult] = await Promise.all([
      projectsApi.list(),
      locationsApi.listAll(),
    ]);
    projects = projectResult.data;
    projectsUnavailable = projectResult.error !== null;
    hasPlaces = locationResult.data.length > 0;
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
                {/* One read of every place reminder, so a row can show it has
                  one without a query per row. */}
                <TaskLocationsProvider>
                {/* Owns the task editor for the whole app, and mirrors it onto
                  the URL — so an open task always has a link to share. */}
                <TaskEditorProvider>
                  <AppShell
                    projects={projects}
                    projectsUnavailable={projectsUnavailable}
                    userEmail={user?.email ?? null}
                    hasPlaces={hasPlaces}
                    pipHidden={pipHidden}
                  >
                    {children}
                  </AppShell>
                  <CommandPalette projects={projects} />
                  <QuickAddModal projects={projects} userId={user?.id ?? null} />
                </TaskEditorProvider>
                </TaskLocationsProvider>
              </SuggestionProvider>
            </QuickAddProvider>
          </TaskEditingHoldProvider>
          <BulkActionBar projects={projects} />
          <StatusSyncRunner />
          {/* Puts a line in the toast whenever the status ↔ schedule rule
              changes something the user didn't ask it to. Mounted once — the
              events fan out from writes anywhere, so a second listener would
              show every notice twice. */}
          <AutoSyncToasts />
        </TaskSelectionProvider>
      </UndoToastProvider>
    </CompletionStreakProvider>
  );
}
