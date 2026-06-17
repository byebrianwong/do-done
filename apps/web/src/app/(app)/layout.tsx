import { AppShell } from "@/components/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { QuickAddModal } from "@/components/quick-add-modal";
import { UndoToastProvider } from "@/components/undo-toast";
import { createServerSupabase } from "@/lib/supabase/server";
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

  let projects: Project[] = [];
  if (user) {
    const projectsApi = new ProjectsApi(supabase, user.id);
    const result = await projectsApi.list();
    projects = result.data;
  }

  return (
    <UndoToastProvider>
      <AppShell projects={projects} userEmail={user?.email ?? null}>
        {children}
      </AppShell>
      <CommandPalette projects={projects} />
      <QuickAddModal projects={projects} userId={user?.id ?? null} />
    </UndoToastProvider>
  );
}
