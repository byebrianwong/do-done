import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Task } from '@do-done/shared';

import QuickAddComposer from '@/components/QuickAddComposer';
import TaskEditModalV2 from '@/components/TaskEditModalV2';
import {
  createProjectOrNull,
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
  const { voice } = useLocalSearchParams<{ voice?: string }>();
  const autoRecord = voice === '1';

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={close} />
      <QuickAddComposer
        autoFocus={!autoRecord}
        autoRecord={autoRecord}
        projects={projects}
        suggestionIndex={suggestionIndex}
        onCreateProject={createProjectOrNull}
        onExpand={setExpandedTask}
        onCreated={close}
      />
      {expandedTask ? (
        <TaskEditModalV2
          task={expandedTask}
          visible
          // The task is already created; closing the editor finishes the
          // capture, so this surface goes with it.
          onClose={close}
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
