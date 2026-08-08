/**
 * Todoist-style quick-add surface. A compact card pinned directly above the
 * keyboard with a title input plus tappable chips for When / Priority /
 * Project / Estimate / Tags. Typed natural-language syntax still works via
 * parseTaskInput (`#tag`, `p1`, `/today`, `~30m`, "tomorrow", …) and merges on
 * submit, with explicit chip selections taking precedence.
 *
 * The fields themselves live in QuickAddFields.tsx, shared with the in-app
 * QuickAddBar. Two behaviors of *this* surface matter as much as the layout,
 * and both mirror Todoist:
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
 * in-app `dodone://quick-add` modal (app/quick-add.tsx). Each host renders its
 * own backdrop for cancel and supplies onCreated for the after-add dismissal.
 * Both pass `projects` — the widget's root has no query provider, so it loads
 * the list straight off ProjectsApi and hands it in the same way.
 *
 * `onExpand` is the door to the full editor: the composer creates the task
 * first and hands the *persisted* task over, so the editor never has to open on
 * unsaved state. Where that editor is differs by host — the in-app modal opens
 * it in place, the widget deep-links into the app, since a translucent
 * home-screen activity is no place for a 3000-line editor.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Project, Task } from '@do-done/shared';
import { getTasksApi } from '@/lib/supabase';
import { hapticSuccess } from '@/lib/haptics';
import { TagRow } from './TaskEditModalV2';
import {
  QuickAddChipRow,
  QuickAddMenuScrim,
  QuickAddPickers,
  useQuickAddFields,
} from './QuickAddFields';

interface QuickAddComposerProps {
  defaultStatus?: 'inbox' | 'not_started';
  onCreated?: () => void;
  /** Focus the input as soon as the composer mounts. */
  autoFocus?: boolean;
  /** Projects for the Project chip. Omit and the chip hides. */
  projects?: Project[];
  /** Provision a project from the Project chip. Omit and the row hides. */
  onCreateProject?: (name: string, color: string) => Promise<Project | null>;
  /**
   * Hand the just-created task to the full editor — notes, subtasks, the
   * calendar, everything the chips don't cover. Omit and the button hides.
   */
  onExpand?: (task: Task) => void;
}

const CARD_PADDING_H = 14;
const WRAPPER_PADDING_H = 12;

export default function QuickAddComposer({
  defaultStatus = 'not_started',
  onCreated,
  autoFocus = false,
  projects,
  onCreateProject,
  onExpand,
}: QuickAddComposerProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const fields = useQuickAddFields({}, projects);

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

  /** Persist what's in the composer. Returns the created task, or null. */
  async function create(): Promise<Task | null> {
    const trimmed = text.trim();
    if (!trimmed || submitting) return null;
    setSubmitting(true);

    const tasks = await getTasksApi();
    const { data, error } = await tasks.create(
      fields.buildInput(trimmed, { status: defaultStatus })
    );
    setSubmitting(false);
    if (error || !data) return null;
    hapticSuccess();
    setText('');
    fields.reset();
    return data;
  }

  async function handleSubmit() {
    if (await create()) onCreated?.();
  }

  async function handleExpand() {
    // Create first, then hand the persisted task over: the full editor
    // autosaves against a real row, so there is no draft state for it to open
    // on. This is why the button needs a title — see the disabled state below.
    const created = await create();
    if (created) onExpand?.(created);
  }

  return (
    <Animated.View
      style={[styles.wrapper, { paddingBottom: insets.bottom + 8 }, liftStyle]}
      pointerEvents="box-none"
    >
      {/* Outside tap closes the open popover — and only the popover; the host's
          own backdrop underneath still dismisses the whole surface. */}
      <QuickAddMenuScrim fields={fields} />

      <QuickAddPickers
        fields={fields}
        onCreateProject={onCreateProject}
        onReturnFocus={() => setTimeout(() => inputRef.current?.focus(), 50)}
      />

      <View style={styles.card}>
        {/* Title row */}
        <View style={styles.titleRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Add a task…"
            placeholderTextColor="#9ca3af"
            value={text}
            onChangeText={(v) => setText(fields.absorbTags(v))}
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
            blurOnSubmit={false}
            editable={!submitting}
          />
          {onExpand ? (
            <Pressable
              style={({ pressed }) => [
                styles.expandBtn,
                pressed && styles.expandBtnPressed,
              ]}
              onPress={handleExpand}
              disabled={submitting || !text.trim()}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Open full editor"
            >
              <Ionicons
                name="open-outline"
                size={20}
                color={text.trim() ? '#6b7280' : '#d1d5db'}
              />
            </Pressable>
          ) : null}
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

        <TagRow
          tags={fields.tags}
          onAdd={fields.addTag}
          onRemove={fields.removeTag}
        />

        <QuickAddChipRow fields={fields} />
      </View>
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
  // Ghost, beside the filled send button: "add" is the primary act here, and
  // the full editor is the way out of quick-add rather than a rival to it.
  expandBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandBtnPressed: {
    backgroundColor: '#f3f4f6',
  },
});
