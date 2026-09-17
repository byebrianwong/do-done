/**
 * The bottom tab bar, which shrinks as you scroll down a list and comes back
 * as you scroll up.
 *
 * It **minimizes; it does not hide.** The labels fade, the icons shrink, and
 * the row goes from 50pt to 30pt — but all four destinations stay where they
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
 * during the sweep is this one and its four children. It is also what turns
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

import React, { useCallback, useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { CommonActions } from '@react-navigation/native';
import type {
  BottomTabBarProps,
  BottomTabNavigationOptions,
} from '@react-navigation/bottom-tabs';

import { useTabBarMinimize } from '@/lib/tab-bar-minimize';
import { prefersReducedMotion } from '@/lib/use-row-exit';
import { hapticSelection } from '@/lib/haptics';
import {
  TAB_ICON_SIZE,
  tabBarHeight,
  tabIconScale,
  tabLabelOpacity,
} from '@/lib/tab-bar-motion';
import {
  TAB_PRESS_DIP_MS,
  TAB_PRESS_DIP_SCALE,
  TAB_PRESS_SPRING,
  TAB_RIPPLE_MS,
  TAB_RIPPLE_SIZE,
  pressedIconScale,
  rippleOpacity,
  rippleScale,
} from '@/lib/tab-press-motion';

const ACTIVE_TINT = '#6366f1';
const INACTIVE_TINT = '#9ca3af';

/** The ripple's colour. Its alpha is animated, so this one is opaque. */
const RIPPLE_TINT = '#6366f1';

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

interface TabBarItemProps {
  options: BottomTabNavigationOptions;
  label: string;
  focused: boolean;
  index: number;
  count: number;
  /** 0 expanded → 1 minimized. Shared by every tab and by the add button. */
  progress: SharedValue<number>;
  hitSlop: { top: number; bottom: number };
  onPress: () => void;
  onLongPress: () => void;
}

/**
 * One tab, and the press it plays.
 *
 * **The press animation has its own clock**, started on press-*in* and run to
 * completion whatever the finger does next. That is the whole point of it: the
 * finger is usually still sitting on the tab it just hit, so a confirmation
 * that lives only while the touch does is one the user cannot see. The ripple
 * spreads out from under the thumb and the icon pops back out from under it,
 * and both are over before the destination screen has settled.
 *
 * This is a component rather than a block inside the bar's `map` because each
 * tab needs its own two shared values, and hooks cannot be called in a loop.
 */
function TabBarItem({
  options,
  label,
  focused,
  index,
  count,
  progress,
  hitSlop,
  onPress,
  onLongPress,
}: TabBarItemProps) {
  // 0 at the moment of the press, 1 when the ripple has cleared. It rests at 1
  // between presses rather than being wound back, which `rippleOpacity` allows
  // by returning 0 at *both* ends.
  const ripple = useSharedValue(1);
  const pop = useSharedValue(1);

  const color = focused
    ? options.tabBarActiveTintColor ?? ACTIVE_TINT
    : options.tabBarInactiveTintColor ?? INACTIVE_TINT;

  const handlePressIn = useCallback(() => {
    // Reduce Motion gets the `pressed` opacity below instead. The rule the app
    // follows elsewhere — land on the end state — has nothing to land on here:
    // the end state of a press is the press being over.
    if (prefersReducedMotion()) return;
    // Restarted rather than resumed, so a second tap on the same tab plays a
    // second ripple instead of picking up the first one's tail. The zero-length
    // step is what guarantees the restart within a single frame.
    ripple.value = withSequence(
      withTiming(0, { duration: 0 }),
      withTiming(1, { duration: TAB_RIPPLE_MS, easing: Easing.out(Easing.quad) })
    );
    pop.value = withSequence(
      withTiming(TAB_PRESS_DIP_SCALE, {
        duration: TAB_PRESS_DIP_MS,
        easing: Easing.out(Easing.quad),
      }),
      withSpring(1, TAB_PRESS_SPRING)
    );
  }, [ripple, pop]);

  const rippleStyle = useAnimatedStyle(() => ({
    opacity: rippleOpacity(ripple.value),
    transform: [{ scale: rippleScale(ripple.value) }],
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressedIconScale(tabIconScale(progress.value), pop.value) }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: tabLabelOpacity(progress.value),
  }));

  return (
    <Pressable
      style={({ pressed }) => [
        styles.item,
        // The only press feedback under Reduce Motion, and harmless otherwise:
        // by the time a finger has been down long enough for this to register,
        // the ripple has already said the same thing louder.
        pressed && prefersReducedMotion() && styles.itemPressed,
      ]}
      onPressIn={handlePressIn}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={hitSlop}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      // Spoken whether or not the printed label is faded out, which is half of
      // why minimizing is safe: nothing a screen reader relies on is carried by
      // the label's opacity.
      accessibilityLabel={
        options.tabBarAccessibilityLabel ??
        (Platform.OS === 'ios' ? `${label}, tab, ${index + 1} of ${count}` : label)
      }
      testID={options.tabBarButtonTestID}
    >
      {/* Behind the icon, and centred on it rather than on the touch point: the
          icon is what the tap chose, and a target this wide would otherwise
          ripple from wherever in a quarter of the screen the thumb landed. The
          row clips it top and bottom, which is what a bounded ripple does. */}
      <Animated.View style={[styles.ripple, rippleStyle]} pointerEvents="none" />
      <Animated.View style={iconStyle}>
        {options.tabBarIcon?.({ focused, color, size: TAB_ICON_SIZE })}
        {/* The default bar draws this for free; a hand-written one has to, and
            a badge that silently never appears is worse than no badge. Inside
            the scaling wrapper so it shrinks with the icon rather than floating
            free of it as the bar minimizes — and so it pops with it on a press.
            Numbers and strings only; the render-function form of `tabBarBadge`
            is not used anywhere here. */}
        {options.tabBarBadge !== undefined &&
        options.tabBarBadge !== null &&
        options.tabBarBadge !== '' ? (
          <View
            style={[styles.badge, options.tabBarBadgeStyle as StyleProp<ViewStyle>]}
            pointerEvents="none"
          >
            <Text style={styles.badgeText} numberOfLines={1} allowFontScaling={false}>
              {String(options.tabBarBadge)}
            </Text>
          </View>
        ) : null}
      </Animated.View>
      <Animated.Text
        style={[styles.label, { color }, labelStyle]}
        numberOfLines={1}
        // The label is fading and being clipped at the same time, so an
        // oversized font would be cut rather than shrunk.
        allowFontScaling={false}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
}

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

  const hitSlop = {
    top: HIT_SLOP_TOP,
    bottom: Math.max(insets.bottom, HIT_SLOP_BOTTOM_MIN),
  };

  return (
    <Animated.View style={[styles.bar, { paddingBottom: insets.bottom }, barStyle]}>
      <View style={styles.row} accessibilityRole="tablist">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;

          // `tabBarLabel` may be a render function; none of this app's tabs
          // use that form, and a title is what they all set.
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options.title ?? route.name;

          const onPress = () => {
            // Every press here does something — navigate, swap the Agenda or
            // Tasks view, or pop a stack back to its index — so the tick is
            // never a promise the bar fails to keep.
            hapticSelection();
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
            <TabBarItem
              key={route.key}
              options={options}
              label={label}
              focused={focused}
              index={index}
              count={state.routes.length}
              progress={progress}
              hitSlop={hitSlop}
              onPress={onPress}
              onLongPress={() =>
                navigation.emit({ type: 'tabLongPress', target: route.key })
              }
            />
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    left: TAB_ICON_SIZE - 8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
  },
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
  ripple: {
    position: 'absolute',
    // Centred on the icon: 5pt of padding, then half of the icon, less half of
    // the disc. Written out rather than guessed, so a change to either size
    // moves the ripple with it.
    top: 5 + TAB_ICON_SIZE / 2 - TAB_RIPPLE_SIZE / 2,
    // Yoga centres an absolute child with no `left`/`right` using the parent's
    // alignment, which is already `center` — said out loud so a later change to
    // the item's layout cannot quietly move the ripple off the icon.
    alignSelf: 'center',
    width: TAB_RIPPLE_SIZE,
    height: TAB_RIPPLE_SIZE,
    borderRadius: TAB_RIPPLE_SIZE / 2,
    backgroundColor: RIPPLE_TINT,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 13,
    marginTop: 2,
  },
});
