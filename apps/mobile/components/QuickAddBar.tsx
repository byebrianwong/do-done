/**
 * The in-app quick-add, pinned above the tab bar on Today / Inbox / Upcoming /
 * All and on a project's screen.
 *
 * Idle it's a single clean line. Focusing it (or typing, or picking anything)
 * expands the card to reveal the same When / Priority / Project / Estimate
 * chips the web bar and the home-screen widget's composer have, so a task can
 * be scheduled, prioritised, filed and estimated without opening the full
 * editor. Typed natural-language syntax keeps working and merges on submit;
 * explicit chip picks win. The slim preview above the card echoes only what
 * the chips don't cover (deadline, tags, recurrence).
 *
 * For everything the chips *can't* reach — notes, subtasks, attachments, the
 * month calendar — the ⇱ button creates the task and opens the full editor on
 * it, mirroring the web bar's "Open full editor".
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Project, Task } from '@do-done/shared';
import { getTasksApi } from '@/lib/supabase';
import { hapticSuccess } from '@/lib/haptics';
import {
  createProjectOrNull,
  useProjects,
  useSuggestionIndex,
} from '@/lib/task-queries';
import { useVoiceQuickAdd } from '@/lib/use-voice-quick-add';
import ParsePreview from './ParsePreview';
import VoiceRecorder, { DictatedNote } from './VoiceRecorder';
import TaskEditModalV2, { TagRow } from './TaskEditModalV2';
import {
  QuickAddChipRow,
  QuickAddSuggestionRow,
  QuickAddMenuScrim,
  QuickAddPickers,
  useQuickAddFields,
} from './QuickAddFields';

interface QuickAddBarProps {
  /**
   * Status for the created task. Defaults to `inbox` — a task typed into a bar
   * on Today / Upcoming / All is capture, not a commitment, and the screen it
   * was typed on implies nothing about triage. A project screen passes
   * `not_started`, since filing into a project *is* the triage.
   */
  defaultStatus?: 'inbox' | 'not_started';
  onCreated?: () => void;
  /** Assign created tasks to this project (e.g. on the project detail screen). */
  projectId?: string;
  /**
   * Schedule created tasks for this day (the Today screen passes today). Like
   * `projectId` it only pre-fills the chip: a typed date replaces it, and it can
   * be cleared outright.
   */
  scheduledDate?: string;
  /**
   * Focus the input as soon as the bar mounts. Used by the quick-add widget
   * deep link so a home-screen tap lands directly in task capture.
   */
  autoFocus?: boolean;
}

export default function QuickAddBar({
  defaultStatus = 'inbox',
  onCreated,
  projectId,
  scheduledDate,
  autoFocus = false,
}: QuickAddBarProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);
  /** The task handed off to the full editor by the expand button, if any. */
  const [expandedTask, setExpandedTask] = useState<Task | null>(null);

  // The screen's own context seeds the chips, so the bar shows where the task
  // is going — and lets the user redirect it without leaving.
  const { data: projects } = useProjects();
  // One counted read of the task history for the session; see useSuggestionIndex.
  const { data: suggestionIndex } = useSuggestionIndex();
  const fields = useQuickAddFields(
    { projectId: projectId ?? null, scheduledDate: scheduledDate ?? null },
    projects,
    suggestionIndex
  );

  // Dictation appends rather than replaces, so speaking into a half-typed line
  // extends it — the same thing typing would have done.
  const voiceQuickAdd = useVoiceQuickAdd({
    onTitle: (spoken) =>
      setText((prev) =>
        fields.absorbTags(prev.trim() ? `${prev.trim()} ${spoken}` : spoken)
      ),
  });

  // Collapse back to one line only once the bar is truly idle: still-focused,
  // half-typed, or chip-carrying states all stay open (matches the web bar).
  // An open picker counts too — otherwise a chip tapped on an empty bar could
  // pull the row it was tapped from out from under its own popover.
  const expanded =
    focused ||
    text.trim().length > 0 ||
    fields.anySet ||
    fields.menu !== null ||
    fields.calendarOpen ||
    // A dictated description isn't visible in the collapsed line, so leaving
    // the bar shut would hide the fact that there is anything to submit.
    voiceQuickAdd.description.length > 0;

  // edgeToEdgeEnabled in app.config.ts disables Android adjustResize, so the
  // absolute-positioned bar would stay behind the keyboard. Track keyboard
  // height and lift the bar above it.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) =>
      setKbHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Pre-focus the input when launched via the quick-add widget. A short delay
  // lets the modal transition settle so the keyboard reliably comes up.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [autoFocus]);

  /** Persist what's in the bar. Returns the created task, or null. */
  async function create(): Promise<Task | null> {
    const trimmed = text.trim();
    if (!trimmed || submitting) return null;
    setSubmitting(true);

    const tasks = await getTasksApi();
    const { data, error } = await tasks.create(
      fields.buildInput(trimmed, {
        status: defaultStatus,
        description: voiceQuickAdd.description,
      })
    );

    // The recording can only be filed once the task it belongs to exists, so
    // this is the first moment there is anything to attach it to.
    if (!error && data) await voiceQuickAdd.flush(data.id);

    setSubmitting(false);
    if (error || !data) return null;
    hapticSuccess();
    setText('');
    fields.reset();
    voiceQuickAdd.reset();
    return data;
  }

  async function handleSubmit() {
    if (await create()) onCreated?.();
  }

  /**
   * Everything the chips can't reach. Create first, then open the editor on the
   * persisted row — it autosaves, so it has nowhere to put unsaved state — and
   * dismiss the keyboard, since the sheet brings its own fields.
   */
  async function handleExpand() {
    const created = await create();
    if (!created) return;
    Keyboard.dismiss();
    setExpandedTask(created);
  }

  return (
    <View
      style={[
        styles.wrapper,
        kbHeight > 0 && { bottom: kbHeight + 8 },
        // An open popover needs the whole screen behind it, so a tap anywhere
        // outside dismisses it. box-none keeps the list underneath tappable.
        fields.menu !== null && styles.wrapperFull,
      ]}
      pointerEvents="box-none"
    >
      <QuickAddMenuScrim fields={fields} />

      <QuickAddPickers
        fields={fields}
        onCreateProject={createProjectOrNull}
        onReturnFocus={() => setTimeout(() => inputRef.current?.focus(), 50)}
      />

      {/* Deadline / tags / recurrence only — the chips below own the rest.
          Reads the list off `fields` rather than the query, so a project
          created from the chip is matchable by name straight away. */}
      <ParsePreview text={text} omitChipFields projects={fields.projects} />

      {voiceQuickAdd.open ? (
        <View style={styles.recorderSlot}>
          <VoiceRecorder voice={voiceQuickAdd.voice} onCancel={voiceQuickAdd.dismiss} />
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.titleRow}>
          <TextInput
            ref={inputRef}
            testID="quick-add-input"
            style={styles.input}
            placeholder="Add a task..."
            placeholderTextColor="#9ca3af"
            value={text}
            onChangeText={(v) => setText(fields.absorbTags(v))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
            blurOnSubmit={false}
            editable={!submitting}
          />
          {expanded ? (
            <Pressable
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.iconButtonActive,
              ]}
              onPress={handleExpand}
              disabled={submitting || !text.trim()}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Open full editor"
            >
              <Ionicons
                name="open-outline"
                size={19}
                color={text.trim() ? '#6b7280' : '#d1d5db'}
              />
            </Pressable>
          ) : null}
          {voiceQuickAdd.supported ? (
            <Pressable
              testID="quick-add-mic"
              accessibilityLabel="Record a voice note"
              style={({ pressed }) => [
                styles.iconButton,
                (pressed || voiceQuickAdd.voice.recording) && styles.iconButtonActive,
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
          <Pressable
            testID="quick-add-submit"
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="add" size={24} color="#fff" />
            )}
          </Pressable>
        </View>

        {expanded ? (
          <>
            <DictatedNote
              description={voiceQuickAdd.description}
              pending={voiceQuickAdd.pending}
              error={voiceQuickAdd.error}
              onClear={voiceQuickAdd.reset}
            />
            <TagRow
              tags={fields.tags}
              onAdd={fields.addTag}
              onRemove={fields.removeTag}
            />
            <QuickAddSuggestionRow fields={fields} title={text} />
            <QuickAddChipRow fields={fields} style={styles.chipRow} />
          </>
        ) : null}
      </View>

      {/* The full editor, opened on the task the expand button just created.
          Mounted only while it's up: it carries a Modal host and six pickers,
          and every list screen in the app renders one of these bars. */}
      {expandedTask ? (
        <TaskEditModalV2
          task={expandedTask}
          visible
          onClose={() => setExpandedTask(null)}
          onSaved={onCreated}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    // Sits just above the tab bar. The Today screen's content area already
    // stops at the top of the tab bar, so this is the gap above it (was 90,
    // which floated the bar too high).
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    justifyContent: 'flex-end',
  },
  wrapperFull: {
    top: 0,
  },
  // The recorder sits above the card rather than replacing it: the chips and
  // whatever was already typed stay put, so a dictation adds to the task being
  // composed instead of looking like it started a new one.
  recorderSlot: { marginBottom: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 10,
  },
  // The card's right padding is tight for the send button; the expanded rows
  // need to breathe out to the same inset as the input.
  chipRow: {
    paddingRight: 12,
    paddingBottom: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  iconButtonActive: {
    backgroundColor: '#eef2ff',
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
});
