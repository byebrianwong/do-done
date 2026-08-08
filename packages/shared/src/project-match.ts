/**
 * Matching a typed `#token` to one of the user's projects.
 *
 * Shared by `extractTitleShortcuts` (the live absorber the title fields run on
 * every keystroke) and `parseTaskInput` (the whole-string parse at quick-add
 * submit), because the same text has to mean the same thing on both. A `#token`
 * that names a project sets the project; anything else is still a tag.
 */

/**
 * The slice of a project the matchers need. `Project` satisfies it, and so does
 * anything a caller can cheaply assemble — the matchers never touch a row.
 */
export interface ProjectRef {
  id: string;
  name: string;
}

/**
 * Comparison key for token↔project-name matching: lowercased, with every
 * non-alphanumeric character dropped.
 *
 * A `#token` is `\w+` by construction, so it can never carry the spaces,
 * punctuation or emoji a project name can. Normalising both sides is what lets
 * `#sideproject` and `#side_project` reach a project actually named
 * "Side Project" — there is no way to type a space inside a token, so without
 * this every multi-word project would be unreachable.
 */
export function projectMatchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The project a typed token names, or undefined.
 *
 * First match wins when two names normalise the same ("Work" / "work!") — the
 * list arrives in the order the sidebar shows it, so the winner is the one the
 * user sees first rather than an arbitrary pick.
 *
 * A key that normalises to empty (a project named only in a script `\w` can't
 * spell, or in emoji) matches nothing, rather than matching every such name.
 */
export function matchProject<T extends ProjectRef>(
  token: string,
  projects: readonly T[] | undefined
): T | undefined {
  if (!projects || projects.length === 0) return undefined;
  const key = projectMatchKey(token);
  if (!key) return undefined;
  return projects.find((p) => projectMatchKey(p.name) === key);
}
