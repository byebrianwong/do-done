/**
 * Links to a tag's view.
 *
 * Same demo rule as `taskPath`: the sandbox runs the whole app one level down,
 * so a bare `/tags/<tag>` would take a signed-out visitor to the login wall
 * the demo exists to get around.
 */

import { encodeTagParam } from "@do-done/shared";
import { DEMO_BASE, isDemoMode } from "@/lib/demo/mode";

/** The index of every tag. */
export function tagsPath(): string {
  return `${isDemoMode() ? DEMO_BASE : ""}/tags`;
}

/** Every task carrying one tag. */
export function tagPath(tag: string): string {
  return `${tagsPath()}/${encodeTagParam(tag)}`;
}
