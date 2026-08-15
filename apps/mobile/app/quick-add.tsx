import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Task } from '@do-done/shared';

import QuickAddComposer from '@/components/QuickAddComposer';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import {
  createProjectOrNull,
  invalidateTasks,
  useProjects,
  useSuggestionIndex,
} from '@/lib/task-queries';

/**
 * In-app deep-link target (`dodone://quick-add`). Presents the same
 * QuickAddComposer used by the home-screen widget over a dimmed backdrop with
 * the input pre-focused. Closing returns to wherever you were — or the Today
 * tab on a cold launch where there's no back stack.
 *
 * `dodone://quick-add?voice=1` opens the same surface straight into recording
 * instead — one composer with two doors, so a dictated task and a typed one
 * are the same task with the same chips.
 *
 * `projectId`, `scheduledDate` and `status` carry the context of the screen
 * the plus button was tapped on (QuickAddButton), which is what keeps the
 * chips pre-filled now that capture happens here rather than in a bar on the
 * screen itself. A deep link arrives with none of them and seeds nothing.
 *
 * Unlike the widget's root, this one lives inside the QueryClientProvider, so
 * the project list its Project chip needs — and the invalidation behind
 * creating one — come for free. The expand button opens the full editor right
 * here rather than deep-linking, since the router is already mounted.
 */
export default function QuickAddModal() {
  const router = useRouter();
  const { data: projects } = useProjects();
  const { data: suggestionIndex } = useSuggestionIndex();
  const [expandedTask, setExpandedTask] = useState<Task | null>(null);
  const { voice, projectId, scheduledDate, status } = useLocalSearchParams<{
    voice?: string;
    projectId?: string;
    scheduledDate?: string;
    status?: string;
  }>();
  const autoRecord = voice === '1';
  // Anything but the one screen that genuinely triages leaves the task in the
  // inbox — see "New tasks start in the inbox" in CLAUDE.md. Read defensively:
  // this is a URL, and it can say anything.
  const defaultStatus = status === 'not_started' ? 'not_started' : 'inbox';

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  /**
   * The screen underneath refetches on focus, but that lands a beat after the
   * backdrop clears — long enough to watch the list not contain the task that
   * was just typed into it. Invalidating here closes that gap.
   */
  const created = () => {
    invalidateTasks();
    close();
  };

  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={close} />
      <QuickAddComposer
        autoFocus={!autoRecord}
        autoRecord={autoRecord}
        defaultStatus={defaultStatus}
        seed={{
          projectId: projectId ?? null,
          scheduledDate: scheduledDate ?? null,
        }}
        projects={projects}
        suggestionIndex={suggestionIndex}
        onCreateProject={createProjectOrNull}
        onExpand={setExpandedTask}
        onCreated={created}
      />
      {expandedTask ? (
        <TaskEditModalV2
          task={expandedTask}
          visible
          // The task is already created; closing the editor finishes the
          // capture, so this surface goes with it.
          onClose={created}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 24, 39, 0.4)',
  },
});
