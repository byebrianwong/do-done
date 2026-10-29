/**
 * Which half of the Agenda tab a system link means, if it means one.
 *
 * The Today and Upcoming widgets and launcher shortcuts open `dodone://today`
 * and `dodone://upcoming`. Those used to land on `app/today.tsx` and
 * `app/upcoming.tsx`, ordinary stack screens that render nothing and then
 * redirect to the tab. With the app already open, that slid a blank page in
 * over whatever was showing before the redirect replaced it.
 * `app/+native-intent.tsx` now rewrites the link before navigation starts: it
 * sets the mode and sends the link straight to the tab.
 *
 * Pure, so the node suite covers it. It has to accept every shape the OS hands
 * over: a custom-scheme URL (where the route is the URL's host), a
 * triple-slash one, an https link on the app's own domain, or a bare path.
 */
import type { AgendaMode } from './view-mode';

export function agendaModeForSystemPath(path: string): AgendaMode | null {
  let rest = path.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest);
  if (scheme) {
    rest = rest.slice(scheme[0].length);
    // On http(s) the first segment is the host, not a route.
    if (/^https?$/i.test(scheme[1])) rest = rest.replace(/^[^/?#]*/, '');
  }
  const route = rest
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  if (route === 'today') return 'today';
  if (route === 'upcoming') return 'upcoming';
  return null;
}
