/**
 * The mobile add-task control: a plus button in the bottom-right corner of
 * Today / Inbox / Upcoming / All and of a project's screen.
 *
 * It used to be a full-width text field pinned across the bottom of every
 * list. The field could be typed into where it stood, but that is not what it
 * was doing for anyone: a tap raised the keyboard and grew the card into the
 * composer, which is a button's job, while the idle line spent the whole width
 * of the screen saying "Add a task…" on top of the tasks it was covering. So
 * the trigger is a button now, and the typing happens in the one place it
 * already happened — `dodone://quick-add`, the composer the home-screen
 * widget, the launcher shortcut and the deep link all open.
 *
 * The screen's context rides along as params, so the chips still open
 * pre-filled: a project screen fills Project, Today fills Date, and a project
 * screen still triages what it captures (`status=not_started`). See
 * "Quick-add pre-fills the fields it can guess" in CLAUDE.md.
 *
 * A long press opens that composer straight into recording. The bar carried a
 * mic beside its field, and a control the user has to go looking for is not
 * the same thing — but a voice note is one tap from here, one tap from the
 * composer's own mic, and one from the launcher's "Voice task", which is
 * enough doors for it.
 */

import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

interface QuickAddButtonProps {
  /**
   * Status for the created task. Defaults to `inbox` — a task captured from
   * Today / Upcoming / All is capture, not a commitment, and the screen it was
   * captured on implies nothing about triage. A project screen passes
   * `not_started`, since filing into a project *is* the triage.
   */
  defaultStatus?: 'inbox' | 'not_started';
  /** Pre-file into this project (the project detail screen). */
  projectId?: string;
  /** Pre-schedule for this day (the Today screen passes today). */
  scheduledDate?: string;
}

export default function QuickAddButton({
  defaultStatus = 'inbox',
  projectId,
  scheduledDate,
}: QuickAddButtonProps) {
  const router = useRouter();

  const open = (voice: boolean) =>
    router.push({
      pathname: '/quick-add',
      params: {
        ...(voice ? { voice: '1' } : {}),
        ...(projectId ? { projectId } : {}),
        ...(scheduledDate ? { scheduledDate } : {}),
        // Only sent when it isn't the default, so the URL says what the screen
        // actually claims about the task rather than restating the default.
        ...(defaultStatus === 'not_started' ? { status: defaultStatus } : {}),
      },
    });

  return (
    <Pressable
      testID="quick-add-button"
      accessibilityRole="button"
      accessibilityLabel="Add task"
      accessibilityHint="Long press to dictate a task"
      style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      onPress={() => open(false)}
      onLongPress={() => open(true)}
      hitSlop={6}
    >
      <Ionicons name="add" size={30} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Sits just above the tab bar, in the corner the thumb reaches. The screen's
  // content area already stops at the top of the tab bar, so this is the gap
  // above it.
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 6,
  },
  fabPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
});
