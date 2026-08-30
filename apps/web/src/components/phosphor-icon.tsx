import {
  PHOSPHOR_PATHS,
  PHOSPHOR_VIEW_BOX,
  QUICK_SCHEDULE_ICON_WEIGHT,
  type PhosphorWeight,
} from "@do-done/shared";

/**
 * Draws a Phosphor icon the app itself chose, by name.
 *
 * Distinct from `ProjectIcon`, which draws whatever `projects.icon` holds and
 * therefore has to decide between an emoji, a token and nothing first. Here the
 * name is a literal in our own source, so there is nothing to parse — but an
 * unknown one still renders nothing rather than throwing, since the paths come
 * from a generated file that can be regenerated without it.
 */
export function PhosphorIcon({
  name,
  weight,
  size = 16,
  className,
  color,
}: {
  /** A key of `PHOSPHOR_PATHS`. */
  name: string;
  weight: PhosphorWeight;
  /** Edge of the square the icon is drawn into, in pixels. */
  size?: number;
  className?: string;
  color?: string;
}) {
  const entry = PHOSPHOR_PATHS[name];
  if (!entry) return null;

  return (
    <svg
      viewBox={PHOSPHOR_VIEW_BOX}
      width={size}
      height={size}
      // Phosphor is filled shapes on a 256 grid — no strokes to scale.
      fill="currentColor"
      style={color ? { color } : undefined}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {weight === "duotone" ? (
        <>
          <path d={entry.duotone.back} opacity={0.2} />
          {entry.duotone.front.map((d) => (
            <path key={d} d={d} />
          ))}
        </>
      ) : (
        entry[weight].map((d) => <path key={d} d={d} />)
      )}
    </svg>
  );
}

/**
 * The glyph for one quick-schedule option, at the size the menus draw it.
 *
 * Every surface offering those five choices renders this, so "This weekend" is
 * a couch in the quick-add chip, the row's submenu, the context menu and both
 * bulk bars alike. The weight is fixed rather than a prop — see
 * `QUICK_SCHEDULE_ICON_WEIGHT`, which exists because `fill` turns the two
 * chevrons into solid triangles.
 */
export function QuickScheduleIcon({
  icon,
  size = 16,
  className,
}: {
  icon: string;
  size?: number;
  className?: string;
}) {
  return (
    <PhosphorIcon
      name={icon}
      weight={QUICK_SCHEDULE_ICON_WEIGHT}
      size={size}
      className={className}
    />
  );
}
