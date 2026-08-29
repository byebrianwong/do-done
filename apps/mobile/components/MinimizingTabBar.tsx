/**
 * The bottom tab bar, which shrinks as you scroll down a list and comes back
 * as you scroll up.
 *
 * It **minimizes; it does not hide.** The labels fade, the icons shrink, and
 * the row goes from 50pt to 30pt — but all five destinations stay where they
 * are and stay tappable. Hiding the bar outright is the pattern reading
 * surfaces use, where the session is long and the content is what matters.
 * A task list is a scan-and-act surface: you scroll to find a row, tick it or
 * open it, and switching views is often the very next thing you do. A switcher
 * you have to scroll back up to reach has been taken away, not tidied.
 *
 * **It floats.** `BottomTabView` lays its tab bar out as a flex sibling of the
 * screens, so a bar with an animating height in that flow would resize the
 * screen — and therefore re-measure the `FlatList` inside it — on every frame
 * of a scroll. Absolutely positioning it takes it out of flow entirely: the
 * screens are full height and unaffected, and the only view that lays out
 * during the sweep is this one and its five children. It is also what turns
 * the 20pt into 20pt of *visible list*, since the list now runs underneath.
 * The other side of that bargain is `useTabBarScrollSync().contentInset`,
 * which is how each list reserves room for its last row to clear the bar.
 *
 * Written by hand rather than wrapped around `BottomTabBar` because that
 * component takes its height from `tabBarStyle`, a plain style prop applied to
 * an RN `Animated.View` — there is nowhere to put a Reanimated shared value.
 * The press behaviour below is the default's, kept deliberately identical:
 * emit `tabPress`, and navigate only if nothing prevented it and the tab isn't
 * already focused.
 */

import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { CommonActions } from '@react-navigation/native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { useTabBarMinimize } from '@/lib/tab-bar-minimize';
import {
  TAB_ICON_SIZE,
  tabBarHeight,
  tabIconScale,
  tabLabelOpacity,
} from '@/lib/tab-bar-motion';

const ACTIVE_TINT = '#6366f1';
const INACTIVE_TINT = '#9ca3af';

/** Borderless, so it reads as Material's own tab ripple rather than a button. */
const ANDROID_RIPPLE = {
  color: 'rgba(99, 102, 241, 0.14)',
  borderless: true,
  radius: 28,
} as const;

/**
 * How far the tap target reaches past the row it is drawn in.
 *
 * A minimized row is 30pt, which is under every platform's touch minimum, so
 * the target has to be bigger than the paint. Downward is free — the safe-area
 * inset below is background nobody can tap for anything else. Upward is a
 * smaller number on purpose: it is taken out of the list, and every list here
 * reserves far more than 10pt of bottom padding.
 */
const HIT_SLOP_TOP = 10;
const HIT_SLOP_BOTTOM_MIN = 12;

export default function MinimizingTabBar({
  state,
  descriptors,
  navigation,
  insets,
}: BottomTabBarProps) {
  const minimize = useTabBarMinimize();
  // The bar is only ever rendered inside the provider; the fallback exists so
  // the hooks below are unconditional rather than to stand in for anything.
  const fallback = useSharedValue(0);
  const progress = minimize?.progress ?? fallback;
  const expand = minimize?.expand;

  // A tab switch is not a scroll. The list you are arriving at has its own
  // offset — usually the top — so the bar starts that screen the way it starts
  // every other one, and the anchor is reset with it.
  useEffect(() => {
    expand?.();
  }, [state.index, expand]);

  const barStyle = useAnimatedStyle(
    () => ({ height: tabBarHeight(progress.value, insets.bottom) }),
    [insets.bottom]
  );
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: tabIconScale(progress.value) }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: tabLabelOpacity(progress.value),
  }));

  const hitSlop = {
    top: HIT_SLOP_TOP,
    bottom: Math.max(insets.bottom, HIT_SLOP_BOTTOM_MIN),
  };

  return (
    <Animated.View
      style={[styles.bar, { paddingBottom: insets.bottom }, barStyle]}
    >
      <View style={styles.row} accessibilityRole="tablist">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const color = focused
            ? options.tabBarActiveTintColor ?? ACTIVE_TINT
            : options.tabBarInactiveTintColor ?? INACTIVE_TINT;

          // `tabBarLabel` may be a render function; none of this app's tabs
          // use that form, and a title is what they all set.
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options.title ?? route.name;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.dispatch({
                ...CommonActions.navigate(route),
                target: state.key,
              });
            }
          };

          return (
            <Pressable
              key={route.key}
              // Press feedback the default bar gave for free and a bare
              // `Pressable` does not: a ripple on Android, a dip in opacity on
              // iOS. Without it the one control that is *always* on screen is
              // the only one in the app that answers a touch with nothing.
              style={({ pressed }) => [
                styles.item,
                pressed && Platform.OS === 'ios' && styles.itemPressed,
              ]}
              android_ripple={ANDROID_RIPPLE}
              onPress={onPress}
              onLongPress={() =>
                navigation.emit({ type: 'tabLongPress', target: route.key })
              }
              hitSlop={hitSlop}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              // Spoken whether or not the printed label is faded out, which is
              // half of why minimizing is safe: nothing a screen reader relies
              // on is carried by the label's opacity.
              accessibilityLabel={
                options.tabBarAccessibilityLabel ??
                (Platform.OS === 'ios'
                  ? `${label}, tab, ${index + 1} of ${state.routes.length}`
                  : label)
              }
              testID={options.tabBarButtonTestID}
            >
              <Animated.View style={iconStyle}>
                {options.tabBarIcon?.({
                  focused,
                  color,
                  size: TAB_ICON_SIZE,
                })}
              </Animated.View>
              <Animated.Text
                style={[styles.label, { color }, labelStyle]}
                numberOfLines={1}
                // The label is fading and being clipped at the same time, so
                // an oversized font would be cut rather than shrunk.
                allowFontScaling={false}
              >
                {label}
              </Animated.Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    // Out of `BottomTabView`'s flex column — see the note at the top.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    // The labels are cut off by the shrinking row rather than laid out again,
    // which is what keeps the sweep to one animating height and no text
    // re-measurement. `tabLabelOpacity` has them gone before the clip reaches
    // them, so what is cut is already invisible.
    overflow: 'hidden',
  },
  row: { flex: 1, flexDirection: 'row' },
  item: {
    flex: 1,
    alignItems: 'center',
    // Anchored to the top, not centred: the icons should stay put as the row
    // closes under them, rather than drifting upward with its midpoint.
    justifyContent: 'flex-start',
    paddingTop: 5,
    overflow: 'hidden',
  },
  itemPressed: { opacity: 0.55 },
  label: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 13,
    marginTop: 2,
  },
});
