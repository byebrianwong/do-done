import { parseProjectIcon } from "@do-done/shared";
import { PHOSPHOR_VIEW_BOX } from "@do-done/shared";

/**
 * Draws whatever `projects.icon` holds — an emoji, a Phosphor icon, or nothing.
 *
 * Every surface that shows a project icon renders this rather than printing the
 * field. Printing it worked while the column only ever held a character; it now
 * also holds `ph:briefcase:fill`, and a row that prints that puts sixteen
 * characters of machine text inside a 20 px ring.
 *
 * Size is in pixels because both callers are drawing into a fixed box (the
 * row's ring, a chip) rather than into running text.
 */
export function ProjectIcon({
  icon,
  size = 12,
  color,
  className,
}: {
  icon?: string | null;
  /** Edge of the square the icon is drawn into. */
  size?: number;
  /**
   * The colour the icon takes — pass the project's own, which is what every
   * surface that shows an icon should do. Leaving it out inherits the
   * surrounding text colour, which is right only where the icon sits on a
   * filled swatch of that colour already (the list pages' circles, the
   * editor's cover) and wrong everywhere else: an icon is the project's
   * identity, and drawing it in body grey throws that away.
   *
   * A colour reaches a drawn icon through `currentColor` and a symbol (★, ◆)
   * as text. A colour emoji has its own and ignores it.
   */
  color?: string;
  className?: string;
}) {
  const parsed = parseProjectIcon(icon);
  if (parsed.kind === "none") return null;

  if (parsed.kind === "emoji") {
    return (
      <span
        className={className}
        style={{ fontSize: size, lineHeight: 1, color }}
        aria-hidden="true"
      >
        {parsed.char}
      </span>
    );
  }

  const { paths, weight } = parsed;
  return (
    <svg
      viewBox={PHOSPHOR_VIEW_BOX}
      width={size}
      height={size}
      // Phosphor is filled shapes on a 256 grid — no strokes to scale.
      fill="currentColor"
      style={{ color }}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {weight === "duotone" ? (
        <>
          <path d={paths.duotone.back} opacity={0.2} />
          {paths.duotone.front.map((d) => (
            <path key={d} d={d} />
          ))}
        </>
      ) : (
        paths[weight].map((d) => <path key={d} d={d} />)
      )}
    </svg>
  );
}

/**
 * The icon followed by the project's name, for the rows and chips that used to
 * interpolate `${icon} ${name}` into a string. Returns just the name when there
 * is no icon, with no stray leading space.
 */
export function ProjectLabel({
  icon,
  name,
  size = 12,
  color,
  className,
}: {
  icon?: string | null;
  name: string;
  size?: number;
  /** The icon's colour — the name keeps the surrounding text colour. */
  color?: string;
  className?: string;
}) {
  const parsed = parseProjectIcon(icon);
  if (parsed.kind === "none") return <>{name}</>;
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <ProjectIcon icon={icon} size={size} color={color} />
      <span>{name}</span>
    </span>
  );
}
