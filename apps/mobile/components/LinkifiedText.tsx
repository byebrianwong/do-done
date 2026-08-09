import React from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextLayoutEventData,
  type TextStyle,
} from 'react-native';
import { linkifyText } from '@do-done/shared';

interface LinkifiedTextProps {
  /** The raw string (task title, notes, …) to render with URLs as links. */
  text: string;
  /** Style for the outer text block. */
  style?: StyleProp<TextStyle>;
  /** Style applied to the link runs on top of the default accent. */
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /**
   * Per-line geometry for the rendered text, once it has been laid out.
   *
   * Passed straight through to the root `Text`. `StruckText` needs it because
   * React Native can't animate `textDecorationLine` and has to draw the rule
   * itself, one view per line.
   */
  onTextLayout?: (e: NativeSyntheticEvent<TextLayoutEventData>) => void;
}

/**
 * Renders a string as a `Text` block, turning any URLs it contains into
 * tappable links (opened with the OS's default handler). Titles are free text
 * ("Buy dog food https://…"), so a bare URL should be tappable rather than
 * dead characters. Link detection lives in `@do-done/shared` so mobile and web
 * linkify identically.
 */
export function LinkifiedText({
  text,
  style,
  linkStyle,
  numberOfLines,
  onTextLayout,
}: LinkifiedTextProps) {
  const segments = linkifyText(text);
  return (
    <Text
      style={style}
      numberOfLines={numberOfLines}
      onTextLayout={onTextLayout}
    >
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <Text key={i}>{seg.value}</Text>
        ) : (
          <Text
            key={i}
            style={[styles.link, linkStyle]}
            // Tapping the link opens it; nested Text.onPress takes the tap so
            // the surrounding row's press (which opens the editor) doesn't fire.
            onPress={() => {
              void Linking.openURL(seg.href!).catch(() => {});
            }}
          >
            {seg.value}
          </Text>
        )
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: {
    color: '#6366f1',
    textDecorationLine: 'underline',
  },
});
