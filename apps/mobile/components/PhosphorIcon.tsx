/**
 * Draws a Phosphor icon the app itself chose, by name.
 *
 * Distinct from `ProjectIcon`, which draws whatever `projects.icon` holds and
 * so has to decide between an emoji, a token and nothing first. Here the name is
 * a literal in our own source, so there is nothing to parse — but an unknown one
 * still renders nothing rather than throwing, since the paths come from a
 * generated file that can be regenerated without it.
 *
 * **This needs `react-native-svg`**, a native module, exactly as `ProjectIcon`
 * does: an install predating it draws nothing here until it is rebuilt.
 */

import React from 'react';
import Svg, { Path } from 'react-native-svg';
import {
  PHOSPHOR_PATHS,
  PHOSPHOR_VIEW_BOX,
  QUICK_SCHEDULE_ICON_WEIGHT,
  type PhosphorWeight,
} from '@do-done/shared';

export function PhosphorIcon({
  name,
  weight,
  size = 16,
  color = '#6b7280',
}: {
  /** A key of `PHOSPHOR_PATHS`. */
  name: string;
  weight: PhosphorWeight;
  size?: number;
  color?: string;
}) {
  const entry = PHOSPHOR_PATHS[name];
  if (!entry) return null;

  return (
    <Svg width={size} height={size} viewBox={PHOSPHOR_VIEW_BOX}>
      {weight === 'duotone' ? (
        <>
          <Path d={entry.duotone.back} fill={color} fillOpacity={0.2} />
          {entry.duotone.front.map((d) => (
            <Path key={d} d={d} fill={color} />
          ))}
        </>
      ) : (
        entry[weight].map((d) => <Path key={d} d={d} fill={color} />)
      )}
    </Svg>
  );
}

/**
 * The glyph for one quick-schedule option, at the size the menus draw it.
 *
 * Web renders the same five glyphs from the same `QUICK_SCHEDULE` entries, so
 * "This weekend" is a couch on the phone and on the laptop. That is why these
 * are Phosphor rather than Ionicons, which is otherwise the icon language for
 * mobile chrome: Ionicons has no sunrise and no couch, so matching web would
 * have meant two different glyph sets for one control.
 */
export function QuickScheduleIcon({
  icon,
  size = 17,
  color,
}: {
  icon: string;
  size?: number;
  color?: string;
}) {
  return (
    <PhosphorIcon
      name={icon}
      weight={QUICK_SCHEDULE_ICON_WEIGHT}
      size={size}
      color={color}
    />
  );
}
