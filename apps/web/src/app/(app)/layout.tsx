import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { QuickAddModal } from "@/components/quick-add-modal";
import { UndoToastProvider } from "@/components/undo-toast";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { TaskSelectionProvider } from "@/lib/task-selection";
import { TaskEditingHoldProvider } from "@/lib/task-editing-hold";
import { QuickAddProvider } from "@/lib/quick-add-context";
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
    <UndoToastProvider>
      <TaskSelectionProvider>
        <TaskEditingHoldProvider>
          <QuickAddProvider projects={projects} userId={user?.id ?? null}>
            <AppShell
              projects={projects}
              userEmail={user?.email ?? null}
              pipHidden={pipHidden}
            >
              {children}
            </AppShell>
            <CommandPalette projects={projects} />
            <QuickAddModal projects={projects} userId={user?.id ?? null} />
          </QuickAddProvider>
        </TaskEditingHoldProvider>
        <BulkActionBar projects={projects} />
      </TaskSelectionProvider>
    </UndoToastProvider>
  );
}
