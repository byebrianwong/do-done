/**
 * Phosphor icons as a second kind of project icon.
 *
 * `projects.icon` used to hold exactly one thing — a character to print. It now
 * holds one of two things, and **`parseProjectIcon` is the only thing that may
 * decide which**. Every surface that draws a project icon goes through it, on
 * both apps and in the widget, because the failure mode of guessing is
 * spectacular: a row that mistakes a token for a glyph renders the literal text
 * `ph:briefcase:fill` inside a 20 px ring.
 *
 * | Stored value        | What it is                                    |
 * | ------------------- | --------------------------------------------- |
 * | `🚀`                | An emoji, or any character. Printed as text.   |
 * | `ph:briefcase:fill` | A Phosphor icon, drawn from `PHOSPHOR_PATHS`.  |
 * | `""` / null         | No icon.                                       |
 *
 * The weight rides *in the token*, so it is a property of the project rather
 * than a setting somewhere else. That is what lets the picker offer it beside
 * the icon grid, where the choice is actually being made, and it means the row
 * needs no second read to draw itself.
 *
 * **An unknown name is not an emoji.** A token naming an icon this build has no
 * paths for — a catalogue trimmed, an older client, a hand-written row — is
 * reported as `none`, so the ring falls back to the project's colour rather
 * than printing the token. Downgrading to a plain coloured ring is the only
 * failure that still looks deliberate.
 */

import {
  PHOSPHOR_CATALOGUE,
  PHOSPHOR_PATHS,
  PHOSPHOR_VIEW_BOX,
  type PhosphorCatalogueIcon,
  type PhosphorIconPaths,
} from "./phosphor-data.generated.js";

export {
  PHOSPHOR_CATALOGUE,
  PHOSPHOR_PATHS,
  PHOSPHOR_VIEW_BOX,
} from "./phosphor-data.generated.js";
export type {
  PhosphorCatalogueGroup,
  PhosphorCatalogueIcon,
  PhosphorDuotonePaths,
  PhosphorIconPaths,
} from "./phosphor-data.generated.js";

export type PhosphorWeight = "bold" | "fill" | "duotone";

/**
 * The three weights the app offers, under the names it calls them.
 *
 * Phosphor's own vocabulary is about stroke weight, which is the wrong axis to
 * ask a user about: "Bold" next to "Fill" reads as two points on one scale when
 * they are two different treatments. The app names describe what you get.
 */
export const PHOSPHOR_WEIGHTS: readonly {
  id: PhosphorWeight;
  label: string;
  hint: string;
}[] = [
  { id: "bold", label: "Outline", hint: "Line only" },
  { id: "fill", label: "Fill", hint: "Solid" },
  { id: "duotone", label: "Light fill", hint: "Solid at 20% behind the line" },
];

/**
 * Fill by default, because the ring is 20 px and the glyph inside it is 12: a
 * line weight drawn on Phosphor's 256 px grid lands under a device pixel there,
 * while a solid shape survives. See the weights comparison in the icon docs.
 */
export const DEFAULT_PHOSPHOR_WEIGHT: PhosphorWeight = "fill";

const PREFIX = "ph:";

export function isPhosphorWeight(value: string): value is PhosphorWeight {
  return PHOSPHOR_WEIGHTS.some((w) => w.id === value);
}

/** The value stored in `projects.icon` for a Phosphor pick. */
export function formatPhosphorIcon(
  name: string,
  weight: PhosphorWeight
): string {
  return `${PREFIX}${name}:${weight}`;
}

export type ParsedProjectIcon =
  | { kind: "none" }
  | { kind: "emoji"; char: string }
  | {
      kind: "phosphor";
      name: string;
      weight: PhosphorWeight;
      paths: PhosphorIconPaths;
    };

const NONE: ParsedProjectIcon = { kind: "none" };

/**
 * Read a stored icon. The one place in the codebase allowed to decide what a
 * `projects.icon` value means.
 */
export function parseProjectIcon(
  icon: string | null | undefined
): ParsedProjectIcon {
  const raw = (icon ?? "").trim();
  if (!raw) return NONE;
  if (!raw.startsWith(PREFIX)) return { kind: "emoji", char: raw };

  const rest = raw.slice(PREFIX.length);
  const cut = rest.lastIndexOf(":");
  const name = cut === -1 ? rest : rest.slice(0, cut);
  const rawWeight = cut === -1 ? "" : rest.slice(cut + 1);

  const paths = PHOSPHOR_PATHS[name];
  if (!paths) return NONE; // an icon this build can't draw — not a glyph
  const weight = isPhosphorWeight(rawWeight) ? rawWeight : DEFAULT_PHOSPHOR_WEIGHT;
  return { kind: "phosphor", name, weight, paths };
}

/**
 * The part of a project's icon that can be concatenated into a plain string —
 * the character for an emoji, and nothing at all for a drawn icon.
 *
 * For the handful of places that genuinely need a `string` rather than an
 * element: a chip's label, a menu row, an accessibility label. Without it those
 * callers reach for `project.icon` directly and print `ph:briefcase:fill` at
 * the user.
 */
export function projectIconText(icon: string | null | undefined): string {
  const parsed = parseProjectIcon(icon);
  return parsed.kind === "emoji" ? parsed.char : "";
}

/** True when the stored value names a Phosphor icon rather than a character. */
export function isPhosphorIcon(icon: string | null | undefined): boolean {
  return (icon ?? "").trim().startsWith(PREFIX);
}

export interface PhosphorSearchResult extends PhosphorCatalogueIcon {
  groupId: string;
}

const ALL: readonly PhosphorSearchResult[] = PHOSPHOR_CATALOGUE.flatMap((g) =>
  g.icons.map((icon) => ({ ...icon, groupId: g.id }))
);

/** Every catalogue entry, flattened, in group order. */
export const PHOSPHOR_ICONS = ALL;

/** Name-and-keyword search, matching the emoji tab's behaviour. */
export function searchPhosphorIcons(
  query: string
): readonly PhosphorSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL;
  return ALL.filter(
    (icon) =>
      icon.label.toLowerCase().includes(q) ||
      icon.name.includes(q) ||
      icon.keywords.some((k) => k.includes(q))
  );
}

/**
 * A complete `<svg>` string for a Phosphor icon.
 *
 * This exists for the Android widget, whose `SvgWidget` takes markup rather
 * than elements — the same reason the Quick Add tile ships as a string. Web and
 * mobile build their own elements from `paths` instead, so nothing has to parse
 * this back out.
 */
export function phosphorSvgMarkup(
  paths: PhosphorIconPaths,
  weight: PhosphorWeight,
  color: string,
  size: number
): string {
  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${PHOSPHOR_VIEW_BOX}" ` +
    `width="${size}" height="${size}" fill="${color}">`;
  if (weight === "duotone") {
    const back = `<path d="${paths.duotone.back}" opacity="0.2"/>`;
    const front = paths.duotone.front.map((d) => `<path d="${d}"/>`).join("");
    return `${open}${back}${front}</svg>`;
  }
  const body = paths[weight].map((d) => `<path d="${d}"/>`).join("");
  return `${open}${body}</svg>`;
}
