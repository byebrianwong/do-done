/**
 * Draws whatever `projects.icon` holds — an emoji, a Phosphor icon, or nothing.
 *
 * Every mobile surface that shows a project icon renders this rather than
 * printing the field into a `<Text>`. Printing worked while the column only held
 * a character; it now also holds `ph:briefcase:fill`, and a row that prints that
 * puts sixteen characters of machine text inside a 22 px ring.
 *
 * `size` is the edge of the square the icon is drawn into. An emoji is a glyph,
 * so it takes the size as a font size — the two land at roughly the same
 * optical weight, which is what keeps a list of mixed projects from looking
 * ragged.
 *
 * **This is the file that needs `react-native-svg`,** which is a native module:
 * an install that predates it renders nothing here until it is rebuilt. That is
 * why `parseProjectIcon` reports an undrawable icon as `none` rather than
 * falling back to text: a bare coloured ring is the only failure here that
 * still looks deliberate.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { PHOSPHOR_VIEW_BOX, parseProjectIcon } from '@do-done/shared';

export function ProjectIcon({
  icon,
  size = 12,
  color,
}: {
  icon?: string | null;
  size?: number;
  /** The colour a *drawn* icon takes. Emoji ignore it — they have their own. */
  color?: string;
}) {
  const parsed = parseProjectIcon(icon);
  if (parsed.kind === 'none') return null;

  if (parsed.kind === 'emoji') {
    return (
      <Text style={[styles.glyph, { fontSize: size, lineHeight: size * 1.2 }]}>
        {parsed.char}
      </Text>
    );
  }

  const { paths, weight } = parsed;
  const fill = color ?? '#111827';
  return (
    <Svg width={size} height={size} viewBox={PHOSPHOR_VIEW_BOX}>
      {weight === 'duotone' ? (
        <>
          <Path d={paths.duotone.back} fill={fill} fillOpacity={0.2} />
          {paths.duotone.front.map((d) => (
            <Path key={d} d={d} fill={fill} />
          ))}
        </>
      ) : (
        paths[weight].map((d) => <Path key={d} d={d} fill={fill} />)
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  glyph: { color: '#111827' },
});
