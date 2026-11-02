/**
 * Todoist-style quick-add surface. A compact card pinned directly above the
 * keyboard with a title input plus tappable chips for When / Priority /
 * Project / Estimate / Tags. Typed natural-language syntax still works via
 * parseTaskInput (`#tag`, `p1`, `/today`, `~30m`, "tomorrow", …) and merges on
 * submit, with explicit chip selections taking precedence.
 *
 * The fields themselves live in QuickAddFields.tsx. Two behaviors of *this*
 * surface matter as much as the layout, and both mirror Todoist:
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
 * Used by the home-screen widget activity (quick-add-root.tsx) and by the
 * in-app `dodone://quick-add` modal (app/quick-add.tsx) — which is also where
 * every list screen's plus button lands, so this is the whole of task capture
 * on mobile. Each host renders its own backdrop for cancel and supplies
 * onCreated for the after-add dismissal.
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
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Project, SuggestionIndex, Task } from '@do-done/shared';
import { getTasksApi } from '@/lib/supabase';
import { hapticSuccess } from '@/lib/haptics';
import { useVoiceQuickAdd } from '@/lib/use-voice-quick-add';
import { QUICK_ADD_LAYOUT_MS, quickAddOpenAction } from '@/lib/quick-add-motion';
import ParsePreview from './ParsePreview';
import VoiceRecorder, { DictatedNote } from './VoiceRecorder';
import { TagRow } from './TaskEditModalV2';
import {
  QuickAddChipRow,
  QuickAddMenuScrim,
  QuickAddSuggestionRow,
  QuickAddPickers,
  useQuickAddFields,
  type QuickAddSeed,
} from './QuickAddFields';

interface QuickAddComposerProps {
  /**
   * Status for the created task. Defaults to `inbox`: this composer is capture,
   * not planning — the home-screen widget and the `dodone://quick-add` deep link
   * both open it with no view context at all, so the task belongs in the
   * untriaged pile until the user says otherwise. A surface whose context
   * already implies triage (a project screen) passes `not_started`.
   */
  defaultStatus?: 'inbox' | 'not_started';
  onCreated?: () => void;
  /**
   * What the surface that opened this composer already implies about the task
   * — the project of the screen the plus button was tapped on, the day the
   * Today screen is. Each seeded facet arrives showing in its chip, and a
   * typed value or a tapped chip replaces it.
   */
  seed?: QuickAddSeed;
  /** Focus the input as soon as the composer mounts. */
  autoFocus?: boolean;
  /**
   * The host's window is already up, so `autoFocus` can focus while mounting
   * and the keyboard rises with the card. True for the in-app modal. The
   * widget's activity leaves it off and keeps a short delay; see
   * `quickAddOpenAction`.
   */
  settled?: boolean;
  /**
   * Take the card off screen while keeping what was typed. The in-app host sets
   * it while the full editor is open over this surface, so an emptied or stale
   * card is not left showing under the editor's sheet.
   */
  hidden?: boolean;
  /**
   * Open recording the moment the composer mounts, instead of the keyboard.
   * This is what the launcher's "Voice task" quick action is: the same
   * composer, entered through the microphone rather than the text field.
   */
  autoRecord?: boolean;
  /** Projects for the Project chip. Until they arrive the chip is drawn dimmed and inert. */
  projects?: Project[];
  /**
   * The counted task history quick-add guesses from. Handed in for the same
   * reason `projects` is — this composer mounts in the widget root, which has
   * no query cache behind it. Omit and nothing is ever suggested.
   */
  suggestionIndex?: SuggestionIndex;
  /** Provision a project from the Project chip. Omit and the row hides. */
  onCreateProject?: (name: string, color: string) => Promise<Project | null>;
  /**
   * Hand the just-created task to the full editor — notes, subtasks, the
   * calendar, everything the chips don't cover. Omit and the button hides.
   */
  onExpand?: (task: Task) => void;
}

/**
 * The card and the rows inside it move to their new place when a row appears
 * or goes, rather than jumping. The card is pinned to the keyboard, so a row
 * appearing inside it moves its top edge; without this that edge jumped about
 * 36px while the user typed. Reanimated skips layout animations under Reduce
 * Motion, so there the card lands on its new size as before.
 */
const LAYOUT = LinearTransition.duration(QUICK_ADD_LAYOUT_MS);

/** Rows that come and go above or inside the card. */
const ROW_ENTERING = FadeIn.duration(160);
const ROW_EXITING = FadeOut.duration(120);

/**
 * The card's own arrival: a short rise on an inner wrapper. The keyboard lift
 * is a transform on the outer view, so the two never write the same property.
 */
const CARD_ENTERING = FadeInDown.duration(220);
const CARD_EXITING = FadeOut.duration(140);

const CARD_PADDING_H = 14;
const WRAPPER_PADDING_H = 12;

export default function QuickAddComposer({
  defaultStatus = 'inbox',
  onCreated,
  seed,
  autoFocus = false,
  settled = false,
  hidden = false,
  autoRecord = false,
  projects,
  suggestionIndex,
  onCreateProject,
  onExpand,
}: QuickAddComposerProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // The double-submit guard. A ref rather than the state above, so a second
  // tap in the same frame sees it, and rather than `editable={false}`, which
  // on Android can drop the keyboard mid-request and drop the card with it.
  const submittingRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const fields = useQuickAddFields(seed, projects, suggestionIndex);

  // Dictation extends the line rather than replacing it, matching what typing
  // after the existing text would have done.
  const voiceQuickAdd = useVoiceQuickAdd({
    onTitle: (spoken) =>
      setText((prev) =>
        fields.absorbTags(prev.trim() ? `${prev.trim()} ${spoken}` : spoken)
      ),
  });

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

  // What happens on mount is decided by quickAddOpenAction. In short: the
  // in-app modal focuses while mounting, so the keyboard rises with the card;
  // the widget's activity is still settling when its root first renders, and
  // an immediate focus there sometimes never brings the IME up, so it waits.
  // Recording waits on both, so a permission dialog does not race the
  // transition.
  // `begin` is rebuilt on every render of the hook, and the effect below must
  // fire exactly once — reading it through a ref is what keeps a re-render
  // from starting a second recording.
  const beginRef = useRef(voiceQuickAdd.begin);
  beginRef.current = voiceQuickAdd.begin;

  const openAction = quickAddOpenAction({ autoFocus, autoRecord, settled });
  const delayMs = 'delayMs' in openAction ? openAction.delayMs : 0;
  useEffect(() => {
    if (openAction.kind !== 'focus-later' && openAction.kind !== 'record-later') {
      return;
    }
    const recordOnOpen = openAction.kind === 'record-later';
    const t = setTimeout(() => {
      if (recordOnOpen) void beginRef.current();
      else inputRef.current?.focus();
    }, delayMs);
    return () => clearTimeout(t);
    // Mount only: the action is fixed by props the host never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Clear the composer for the next task. */
  function clear() {
    setText('');
    fields.reset();
    voiceQuickAdd.reset();
  }

  /**
   * Persist what's in the composer. Returns the created task, or null.
   *
   * It does not clear the composer. A host that closes after a create would
   * otherwise show an emptied card while it fades out, so clearing is left to
   * the caller, and only done when nothing is about to close.
   *
   * On success the double-submit guard stays latched. The text is still in the
   * field while the host closes, so a second tap or Return in that window
   * would otherwise create the task again. The caller releases it only if the
   * composer stays open.
   */
  async function create(): Promise<Task | null> {
    const trimmed = text.trim();
    if (!trimmed || submittingRef.current) return null;
    submittingRef.current = true;
    setSubmitting(true);

    let created: Task | null = null;
    try {
      const tasks = await getTasksApi();
      const { data, error } = await tasks.create(
        fields.buildInput(trimmed, {
          status: defaultStatus,
          description: voiceQuickAdd.description,
        })
      );
      // Nothing to attach a recording to until the task exists.
      if (!error && data) await voiceQuickAdd.flush(data.id);
      if (error || !data) return null;
      hapticSuccess();
      created = data;
      return data;
    } finally {
      if (!created) submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    const created = await create();
    if (!created) return;
    // Every current host closes here. One that did not would want the
    // composer emptied for the next task.
    if (onCreated) onCreated();
    else {
      clear();
      submittingRef.current = false;
    }
  }

  async function handleExpand() {
    // Create first, then hand the persisted task over: the full editor
    // autosaves against a real row, so there is no draft state for it to open
    // on. This is why the button needs a title — see the disabled state below.
    // Not cleared either, and the guard stays latched: both hosts take the
    // composer off screen here and then close.
    const created = await create();
    if (created) onExpand?.(created);
  }

  return (
    <Animated.View
      style={[styles.wrapper, { paddingBottom: insets.bottom + 8 }, liftStyle]}
      pointerEvents="box-none"
    >
      {hidden ? null : (
        <>
          {/* Outside tap closes the open popover — and only the popover; the
              host's own backdrop underneath still dismisses the whole
              surface. */}
          <QuickAddMenuScrim fields={fields} />

          {/* `layout` here too: the stack is bottom-anchored, so when anything
              in it grows, its top edge moves. Animating the stack's frame and
              the card's together keeps the card's bottom still and lets its
              top glide, instead of jumping up and then settling. */}
          <Animated.View
            style={styles.stack}
            pointerEvents="box-none"
            entering={CARD_ENTERING}
            exiting={CARD_EXITING}
            layout={LAYOUT}
          >
            <QuickAddPickers
              fields={fields}
              onCreateProject={onCreateProject}
              onReturnFocus={() => setTimeout(() => inputRef.current?.focus(), 50)}
            />

            {/* Deadline / recurrence only — the chips and the tag row own the
                rest. Reads the list off `fields` rather than the host's prop,
                so a project created from the chip is matchable by name
                straight away. */}
            <ParsePreview text={text} omitChipFields projects={fields.projects} />

            {voiceQuickAdd.open ? (
              <Animated.View
                style={styles.recorderSlot}
                entering={ROW_ENTERING}
                exiting={ROW_EXITING}
                layout={LAYOUT}
              >
                <VoiceRecorder voice={voiceQuickAdd.voice} onCancel={voiceQuickAdd.dismiss} />
              </Animated.View>
            ) : null}

            <Animated.View style={styles.card} layout={LAYOUT}>
              {/* Title row */}
              <Animated.View style={styles.titleRow} layout={LAYOUT}>
                <TextInput
                  ref={inputRef}
                  testID="quick-add-input"
                  style={styles.input}
                  placeholder="Add a task…"
                  placeholderTextColor="#9ca3af"
                  value={text}
                  onChangeText={(v) => setText(fields.absorbTags(v))}
                  onSubmitEditing={handleSubmit}
                  // The field wraps so a long title can be read in full. A
                  // dictated title runs up to VOICE_TITLE_MAX_CHARS, and on one
                  // line most of it scrolled out of sight. Return still adds
                  // the task and keeps the keyboard up. It never inserts a
                  // newline.
                  multiline
                  submitBehavior="submit"
                  returnKeyType="done"
                  // Focus while mounting on a settled host, so the keyboard
                  // rises with the card. The field stays editable while a
                  // create is in flight: see `submittingRef`.
                  autoFocus={openAction.kind === 'focus-on-mount'}
                />
                {voiceQuickAdd.supported ? (
                  <Pressable
                    testID="quick-add-mic"
                    accessibilityLabel="Record a voice note"
                    style={({ pressed }) => [
                      styles.micBtn,
                      (pressed || voiceQuickAdd.voice.recording) && styles.micBtnActive,
                    ]}
                    onPress={() => void voiceQuickAdd.begin()}
                    disabled={submitting || voiceQuickAdd.voice.recording}
                    hitSlop={4}
                  >
                    <Ionicons
                      name={voiceQuickAdd.voice.recording ? 'mic' : 'mic-outline'}
                      size={20}
                      color={voiceQuickAdd.voice.recording ? '#6366f1' : '#6b7280'}
                    />
                  </Pressable>
                ) : null}
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
                  testID="quick-add-submit"
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
              </Animated.View>

              <DictatedNote
                description={voiceQuickAdd.description}
                pending={voiceQuickAdd.pending}
                error={voiceQuickAdd.error}
                onClear={voiceQuickAdd.reset}
              />

              <Animated.View layout={LAYOUT}>
                <TagRow
                  tags={fields.tags}
                  onAdd={fields.addTag}
                  onRemove={fields.removeTag}
                />
              </Animated.View>

              <QuickAddSuggestionRow fields={fields} title={text} />

              {/* Not wrapped: its onLayout reads its x inside the card, which
                  is what lines a popover up with its chip. It carries its own
                  `layout` transition. */}
              <QuickAddChipRow fields={fields} />
            </Animated.View>
          </Animated.View>
        </>
      )}
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
    // Grows with the text to about five lines, then scrolls. The buttons
    // beside it are bottom-aligned (titleRow), so they stay by the keyboard.
    maxHeight: 120,
    textAlignVertical: 'top',
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
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnActive: { backgroundColor: '#eef2ff' },
  // Popovers, preview, recorder and card, stacked from the bottom. The arrival
  // animation lives here so the lift transform on `wrapper` is left alone.
  stack: {
    alignSelf: 'stretch',
  },
  // Above the card, not in place of it: the chips and anything already typed
  // stay visible, so a dictation reads as adding to this task rather than
  // starting a different one.
  recorderSlot: { marginBottom: 8 },
});
