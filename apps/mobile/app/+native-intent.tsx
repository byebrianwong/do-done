/**
 * Rewrites a system link before Expo Router navigates to it.
 *
 * Only the Agenda links are rewritten: `dodone://today` and
 * `dodone://upcoming` set the Agenda tab's mode and go straight to the tab,
 * rather than through a blank redirect screen. See `lib/agenda-link.ts`.
 * Everything else passes through unchanged, including the launch URL a plain
 * tap on the app icon produces.
 *
 * A notification tap does not come through here: it is an in-app
 * `router.push`, which still uses `app/today.tsx` and `app/upcoming.tsx`.
 */
import { agendaModeForSystemPath } from '@/lib/agenda-link';
import { setAgendaMode } from '@/lib/view-mode';

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    const mode = agendaModeForSystemPath(path);
    if (!mode) return path;
    setAgendaMode(mode);
    return '/';
  } catch {
    // Expo Router crashes the app on a throw here. The redirect screens are
    // still there to handle the link the old way.
    return path;
  }
}
