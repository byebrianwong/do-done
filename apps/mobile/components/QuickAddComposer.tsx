/**
 * Todoist-style quick-add surface. A compact card pinned directly above the
 * keyboard with a title input plus tappable chips for When / Priority /
 * Estimate / Tags. Typed natural-language syntax still works via parseTaskInput
 * (`#tag`, `p1`, `/today`, `~30m`, "tomorrow", …) and merges on submit, with
 * explicit chip selections taking precedence.
 *
 * Two behaviors matter as much as the layout, and both mirror Todoist:
 *
 *  1. The card never moves on its own. It rides the keyboard via Reanimated's
 *     `useAnimatedKeyboard`, which reads the IME inset frame-by-frame from
 *     WindowInsets, so the card tracks the keyboard's own animation instead of
 *     snapping to a `keyboardDidShow` measurement after the fact. (The hosting
 *     activities must be `adjustResize` — with edge-to-edge that means the
 *     window holds still and this offset is the only thing that moves. See
 *     plugins/withQuickAddActivity.js.)
 *
 *  2. The chips keep the keyboard up. Their options render as inline popovers
 *     anchored above the card, in the same window — not as `Modal`s, which on
 *     Android open a new window, drop the IME, and collapse the composer back
 *     down. Only the full month calendar, which can't fit above the keyboard,
 *     takes over the screen; the input is refocused when it closes.
 *
 * Used by both the home-screen widget activity (quick-add-root.tsx) and the
 * in-app `dodone://quick-add` modal (app/quick-add.tsx). Each host supplies its
 * own dismissal via onClose / onCreated.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  ScrollView,
  Text,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { parseTaskInput } from '@do-done/task-engine';
import {
  PRIORITY_CONFIG,
  QUICK_SCHEDULE,
  formatScheduleHint,
  resolveQuickSchedule,
  type CreateTaskInput,
  type TaskPriority,
} from '@do-done/shared';
import { getTasksApi } from '@/lib/supabase';
import { hapticSuccess } from '@/lib/haptics';
import {
  PickerSheet,
  WhenCalendar,
  TagRow,
  PRIORITY_PICKER_OPTIONS,
  ESTIMATE_PICKER_OPTIONS,
  PRIORITY_COLORS,
  extractCompletedTags,
  shortDateLabel,
} from './TaskEditModalV2';

interface QuickAddComposerProps {
  defaultStatus?: 'inbox' | 'not_started';
  onCreated?: () => void;
  /** Dismiss without creating (backdrop tap / cancel). */
  onClose?: () => void;
  /** Focus the input as soon as the composer mounts. */
  autoFocus?: boolean;
}

/** Which chip's popover is open, if any. */
type OpenMenu = 'when' | 'priority' | 'estimate' | null;

interface MenuItem {
  key: string;
  label: string;
  /** Muted right-hand annotation, e.g. the concrete date behind "Tomorrow". */
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  selected?: boolean;
}

const POPOVER_WIDTH = 252;
const CARD_PADDING_H = 14;
const WRAPPER_PADDING_H = 12;

function durationLabel(minutes: number | null): string {
  if (!minutes) return 'Estimate';
  return minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * A chip's options, floating directly above the card and anchored to the chip
 * that opened it. Lives in the composer's own view hierarchy so the text input
 * never loses focus — the whole point of the surface.
 */
function Popover({
  anchorX,
  availableWidth,
  items,
  onSelect,
}: {
  anchorX: number;
  availableWidth: number;
  items: MenuItem[];
  onSelect: (key: string) => void;
}) {
  const left = availableWidth
    ? clamp(CARD_PADDING_H + anchorX, 0, Math.max(availableWidth - POPOVER_WIDTH, 0))
    : CARD_PADDING_H;

  return (
    <View style={[styles.popover, { marginLeft: left }]}>
      <ScrollView
        style={styles.popoverScroll}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        {items.map((item) => {
          return (
            <Pressable
              key={item.key}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => [
                styles.menuRow,
                pressed && styles.menuRowPressed,
              ]}
            >
              <Ionicons
                name={item.icon}
                size={17}
                color={item.color ?? '#6b7280'}
              />
              <Text style={styles.menuLabel} numberOfLines={1}>
                {item.label}
              </Text>
              {item.hint ? (
                <Text style={styles.menuHint}>{item.hint}</Text>
              ) : null}
              {item.selected ? (
                <Ionicons name="checkmark" size={16} color="#6366f1" />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function QuickAddComposer({
  defaultStatus = 'not_started',
  onCreated,
  onClose,
  autoFocus = false,
}: QuickAddComposerProps) {
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [whenDate, setWhenDate] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const [menu, setMenu] = useState<OpenMenu>(null);
  const [anchors, setAnchors] = useState({ when: 0, priority: 0, estimate: 0 });
  const [cardWidth, setCardWidth] = useState(0);
  /** The full month grid — the one picker too tall to float over the keyboard. */
  const [calendarOpen, setCalendarOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });

  // Ride the keyboard instead of chasing it: the inset is read per frame, so
  // the card rises and falls with the IME rather than jumping after it lands.
  // The resting position already clears the gesture bar (paddingBottom below),
  // and the reported IME height covers that same strip, so lift by the
  // difference — otherwise the bar's height gets counted twice.
  const liftStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -Math.max(keyboard.height.value - insets.bottom, 0) },
    ],
  }));

  // Focus after mount rather than via `autoFocus`: the widget's activity is
  // still settling when the root first renders, and an immediate focus there
  // sometimes never brings the IME up.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [autoFocus]);

  // Back closes an open popover instead of tearing down the whole surface —
  // the hosts' back handling only takes over once nothing is layered on top.
  useEffect(() => {
    if (menu === null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setMenu(null);
      return true;
    });
    return () => sub.remove();
  }, [menu]);

  const anchorFor = (chip: keyof typeof anchors) => (e: LayoutChangeEvent) => {
    const { x } = e.nativeEvent.layout;
    setAnchors((prev) => (prev[chip] === x ? prev : { ...prev, [chip]: x }));
  };

  const toggleMenu = (next: Exclude<OpenMenu, null>) =>
    setMenu((current) => (current === next ? null : next));

  // Live-extract whitespace-terminated `#tag` tokens into chips as the user
  // types (same behavior as the detailed editor's title field).
  const handleChangeText = (v: string) => {
    const { stripped, tags: extracted } = extractCompletedTags(v);
    if (extracted.length > 0) {
      setTags((prev) => {
        const seen = new Set(prev);
        const fresh = extracted.filter((t) => !seen.has(t));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
      setText(stripped);
    } else {
      setText(v);
    }
  };

  const addTag = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  const removeTag = (tag: string) =>
    setTags((prev) => prev.filter((t) => t !== tag));

  // ── Menu contents ───────────────────────────────────────

  // Resolve the shortcuts once per render so the label, the hint and the
  // selected checkmark all agree on what "This weekend" means today.
  const quickDates = useMemo(
    () => QUICK_SCHEDULE.map((q) => ({ ...q, date: resolveQuickSchedule(q.key) })),
    []
  );

  // Keys are the shortcut names, not the dates they resolve to: on a Friday
  // "Today" and "This week" land on the same date, and duplicate keys would
  // collide.
  const whenItems: MenuItem[] = [
    ...quickDates.map((q) => ({
      key: q.key,
      label: q.label,
      hint: formatScheduleHint(q.date),
      icon: 'calendar-outline' as const,
      color: '#6366f1',
      selected: whenDate === q.date,
    })),
    {
      key: 'custom',
      label: 'Pick a date…',
      icon: 'calendar-number-outline' as const,
      color: '#6b7280',
      // A date nothing in the shortcut list covers still shows as chosen here.
      selected: !!whenDate && !quickDates.some((q) => q.date === whenDate),
    },
    ...(whenDate
      ? [
          {
            key: 'none',
            label: 'No date',
            icon: 'close-circle-outline' as const,
            color: '#9ca3af',
          },
        ]
      : []),
  ];

  const priorityItems: MenuItem[] = [
    ...PRIORITY_PICKER_OPTIONS.map((p) => ({
      key: p.value,
      label: p.label,
      hint: p.code,
      icon: 'flag' as const,
      color: PRIORITY_COLORS[p.value],
      selected: priority === p.value,
    })),
    ...(priority
      ? [
          {
            key: 'none',
            label: 'No priority',
            icon: 'close-circle-outline' as const,
            color: '#9ca3af',
          },
        ]
      : []),
  ];

  const estimateItems: MenuItem[] = [
    ...ESTIMATE_PICKER_OPTIONS.map((b) => ({
      key: String(b.minutes),
      label: b.label,
      hint: b.code,
      icon: 'time-outline' as const,
      color: '#6366f1',
      selected: duration === b.minutes,
    })),
    ...(duration
      ? [
          {
            key: 'none',
            label: 'No estimate',
            icon: 'close-circle-outline' as const,
            color: '#9ca3af',
          },
        ]
      : []),
  ];

  const selectWhen = (key: string) => {
    setMenu(null);
    if (key === 'custom') {
      setCalendarOpen(true);
      return;
    }
    if (key === 'none') {
      setWhenDate(null);
      return;
    }
    setWhenDate(quickDates.find((q) => q.key === key)?.date ?? null);
  };

  const selectPriority = (key: string) => {
    setPriority(key === 'none' ? null : (key as TaskPriority));
    setMenu(null);
  };

  const selectEstimate = (key: string) => {
    setDuration(key === 'none' ? null : parseInt(key, 10));
    setMenu(null);
  };

  const closeCalendar = () => {
    setCalendarOpen(false);
    // The month grid is a Modal, so it took the keyboard with it. Hand focus
    // back so the user carries on typing where they left off.
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);

    // Parse remaining typed syntax; explicit chip selections win over parsed.
    const parsed = parseTaskInput(trimmed);
    const mergedTags = Array.from(new Set([...tags, ...(parsed.tags ?? [])]));
    const finalPriority = priority ?? parsed.priority ?? undefined;
    const finalDuration = duration ?? parsed.duration_minutes ?? undefined;
    const finalWhenDate = whenDate ?? parsed.when_date ?? undefined;

    const input: CreateTaskInput = {
      title: parsed.title || trimmed,
      status: defaultStatus,
      ...(finalPriority && { priority: finalPriority }),
      ...(finalWhenDate && { when_date: finalWhenDate }),
      ...(parsed.due_date && { due_date: parsed.due_date }),
      ...(parsed.due_time && { due_time: parsed.due_time }),
      ...(finalDuration && { duration_minutes: finalDuration }),
      ...(mergedTags.length > 0 && { tags: mergedTags }),
      ...(parsed.recurrence_rule && { recurrence_rule: parsed.recurrence_rule }),
    };

    const tasks = await getTasksApi();
    const { error } = await tasks.create(input);
    setSubmitting(false);
    if (!error) {
      hapticSuccess();
      setText('');
      setTags([]);
      setPriority(null);
      setWhenDate(null);
      setDuration(null);
      setMenu(null);
      onCreated?.();
    }
  }

  const whenSet = !!whenDate;

  return (
    <Animated.View
      style={[styles.wrapper, { paddingBottom: insets.bottom + 8 }, liftStyle]}
      pointerEvents="box-none"
    >
      {/* Outside tap closes the open popover — and only the popover; the host's
          own backdrop underneath still dismisses the whole surface. */}
      {menu !== null && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setMenu(null)}
        />
      )}

      {menu === 'when' && (
        <Popover
          anchorX={anchors.when}
          availableWidth={cardWidth}
          items={whenItems}
          onSelect={selectWhen}
        />
      )}
      {menu === 'priority' && (
        <Popover
          anchorX={anchors.priority}
          availableWidth={cardWidth}
          items={priorityItems}
          onSelect={selectPriority}
        />
      )}
      {menu === 'estimate' && (
        <Popover
          anchorX={anchors.estimate}
          availableWidth={cardWidth}
          items={estimateItems}
          onSelect={selectEstimate}
        />
      )}

      <View
        style={styles.card}
        onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}
      >
        {/* Title row */}
        <View style={styles.titleRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Add a task…"
            placeholderTextColor="#9ca3af"
            value={text}
            onChangeText={handleChangeText}
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
            blurOnSubmit={false}
            editable={!submitting}
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              (pressed || !text.trim()) && styles.sendBtnMuted,
            ]}
            onPress={handleSubmit}
            disabled={submitting || !text.trim()}
            hitSlop={4}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={22} color="#fff" />
            )}
          </Pressable>
        </View>

        {/* Tags */}
        <TagRow tags={tags} onAdd={addTag} onRemove={removeTag} />

        {/* Chip row */}
        <View style={styles.chipRow}>
          <Pressable
            style={[
              styles.chip,
              whenSet && styles.chipActive,
              menu === 'when' && styles.chipOpen,
            ]}
            onPress={() => toggleMenu('when')}
            onLayout={anchorFor('when')}
            hitSlop={4}
          >
            <Ionicons
              name="calendar-outline"
              size={15}
              color={whenSet ? '#4338ca' : '#6b7280'}
            />
            <Text style={[styles.chipText, whenSet && styles.chipTextActive]}>
              {whenSet ? shortDateLabel(whenDate) : 'Date'}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.chip,
              priority && styles.chipActive,
              menu === 'priority' && styles.chipOpen,
            ]}
            onPress={() => toggleMenu('priority')}
            onLayout={anchorFor('priority')}
            hitSlop={4}
          >
            <Ionicons
              name="flag"
              size={15}
              color={priority ? PRIORITY_COLORS[priority] : '#6b7280'}
            />
            <Text
              style={[
                styles.chipText,
                priority && { color: PRIORITY_COLORS[priority], fontWeight: '700' },
              ]}
            >
              {priority ? PRIORITY_CONFIG[priority].label : 'Priority'}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.chip,
              !!duration && styles.chipActive,
              menu === 'estimate' && styles.chipOpen,
            ]}
            onPress={() => toggleMenu('estimate')}
            onLayout={anchorFor('estimate')}
            hitSlop={4}
          >
            <Ionicons
              name="time-outline"
              size={15}
              color={duration ? '#4338ca' : '#6b7280'}
            />
            <Text style={[styles.chipText, !!duration && styles.chipTextActive]}>
              {durationLabel(duration)}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Full month grid — the one picker that needs the whole screen. */}
      <PickerSheet
        visible={calendarOpen}
        title="Date"
        options={[]}
        selectedKey=""
        onSelect={() => {}}
        onClose={closeCalendar}
        header={
          <WhenCalendar
            whenDate={whenDate}
            busyness={[]}
            onPickDate={(date) => {
              setWhenDate(date);
              closeCalendar();
            }}
          />
        }
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Fills the host so the popover has room to stack above the card; the card
  // itself is pinned to the bottom edge, above the keyboard.
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    paddingHorizontal: WRAPPER_PADDING_H,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: CARD_PADDING_H,
    paddingTop: 10,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 8,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnMuted: {
    backgroundColor: '#c7d2fe',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f3f4f6',
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipActive: {
    backgroundColor: '#eef2ff',
  },
  // The chip stays visibly "held down" while its popover is open, so the two
  // read as one control.
  chipOpen: {
    backgroundColor: '#e0e7ff',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  chipTextActive: {
    color: '#4338ca',
    fontWeight: '700',
  },
  popover: {
    alignSelf: 'flex-start',
    width: POPOVER_WIDTH,
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  popoverScroll: {
    // Tall enough for every menu we show, short enough to never crowd the card.
    maxHeight: 320,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  menuRowPressed: {
    backgroundColor: '#f3f4f6',
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    fontWeight: '500',
  },
  menuHint: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '500',
  },
});
