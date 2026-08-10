import React from 'react';
import { SvgWidget, TextWidget } from 'react-native-android-widget';
import { parseProjectIcon, phosphorSvgMarkup } from '@do-done/shared';

/**
 * The project's icon inside a widget row's ring.
 *
 * The launcher's widget host draws none of React Native — no `react-native-svg`
 * reaches it — so a drawn icon has to arrive as **markup**, through `SvgWidget`,
 * exactly as the Quick Add tile's artwork does. `phosphorSvgMarkup` in
 * @do-done/shared builds that string from the same path data the two apps
 * render as elements, so a widget and a list can never disagree about what a
 * project's icon is.
 *
 * An emoji stays a `TextWidget`: it is a character, and the launcher's own
 * font draws it in colour.
 *
 * `AndroidSVG` swallows a parse failure with a bare `printStackTrace`, which is
 * why nothing here interpolates anything but our own generated path data and a
 * hex colour.
 */
export function WidgetProjectIcon({
  icon,
  size,
  color,
}: {
  icon?: string | null;
  /** Edge of the square inside the ring — 9 on a row, 12 on the Next up card. */
  size: number;
  /** The ring's colour. A drawn icon takes it; an emoji brings its own. */
  color: string;
}) {
  const parsed = parseProjectIcon(icon);
  if (parsed.kind === 'none') return null;

  if (parsed.kind === 'emoji') {
    return <TextWidget text={parsed.char} style={{ fontSize: size }} />;
  }

  return (
    <SvgWidget
      svg={phosphorSvgMarkup(parsed.paths, parsed.weight, color, size)}
      style={{ width: size, height: size }}
    />
  );
}
