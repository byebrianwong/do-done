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
import { IS_EXPO_GO } from '@/lib/runtime';
import { createProjectOrNull, useProjects } from '@/lib/task-queries';
import ParsePreview from './ParsePreview';
import TaskEditModalV2, { TagRow } from './TaskEditModalV2';
import {
  QuickAddChipRow,
  QuickAddMenuScrim,
  QuickAddPickers,
  useQuickAddFields,
} from './QuickAddFields';

// expo-speech-recognition has custom native code, not in Expo Go's bundled
// runtime. Lazy-load it only when we have a dev client / standalone build,
// and stub out the API in Expo Go so the mic button can hide gracefully.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ExpoSpeechRecognitionModule: any = {
  start: () => {},
  stop: () => {},
  requestPermissionsAsync: async () => ({ granted: false }),
};
type SpeechEventName = 'result' | 'end' | 'error';
let useSpeechRecognitionEvent: (
  name: SpeechEventName,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (e: any) => void
) => void = () => {};

if (!IS_EXPO_GO) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition');
    ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule;
    useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
  } catch {
    // module not available — mic stays hidden
  }
}

const VOICE_ENABLED = !IS_EXPO_GO && Platform.OS !== 'web';

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
   * Focus the input as soon as the bar mounts. Used by the quick-add widget
   * deep link so a home-screen tap lands directly in task capture.
   */
  autoFocus?: boolean;
}

export default function QuickAddBar({
  defaultStatus = 'inbox',
  onCreated,
  projectId,
  autoFocus = false,
}: QuickAddBarProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [focused, setFocused] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);
  /** The task handed off to the full editor by the expand button, if any. */
  const [expandedTask, setExpandedTask] = useState<Task | null>(null);

  // The screen's project seeds the chip, so the project page's bar shows where
  // the task is going — and lets the user redirect it without leaving.
  const { data: projects } = useProjects();
  const fields = useQuickAddFields({ projectId: projectId ?? null }, projects);

  // Collapse back to one line only once the bar is truly idle: still-focused,
  // half-typed, or chip-carrying states all stay open (matches the web bar).
  // An open picker counts too — otherwise a chip tapped on an empty bar could
  // pull the row it was tapped from out from under its own popover.
  const expanded =
    focused ||
    text.trim().length > 0 ||
    fields.anySet ||
    fields.menu !== null ||
    fields.calendarOpen;

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

  // Speech recognition events
  useSpeechRecognitionEvent('result', (e) => {
    const transcript = e.results?.[0]?.transcript;
    if (transcript) {
      setText(transcript);
    }
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', () => setListening(false));

  useEffect(() => {
    return () => {
      // Stop listening if component unmounts
      if (listening) {
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          // ignore
        }
      }
    };
  }, [listening]);

  /** Persist what's in the bar. Returns the created task, or null. */
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

  async function toggleListening() {
    if (listening) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // ignore
      }
      setListening(false);
      return;
    }

    if (Platform.OS === 'web') {
      // Web Speech API isn't reliable cross-browser; tell the user.
      return;
    }

    const result =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      return;
    }

    setListening(true);
    setText('');
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: false,
    });
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

      <View style={styles.card}>
        <View style={styles.titleRow}>
          <TextInput
            ref={inputRef}
            testID="quick-add-input"
            style={styles.input}
            placeholder={listening ? 'Listening...' : 'Add a task...'}
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
          {VOICE_ENABLED ? (
            <Pressable
              style={({ pressed }) => [
                styles.iconButton,
                (pressed || listening) && styles.iconButtonActive,
              ]}
              onPress={toggleListening}
              disabled={submitting}
              hitSlop={4}
            >
              <Ionicons
                name={listening ? 'mic' : 'mic-outline'}
                size={20}
                color={listening ? '#6366f1' : '#6b7280'}
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
            <TagRow
              tags={fields.tags}
              onAdd={fields.addTag}
              onRemove={fields.removeTag}
            />
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
