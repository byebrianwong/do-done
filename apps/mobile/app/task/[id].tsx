import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import TaskEditModalV2 from '@/components/TaskEditModalV2';
import { getTasksApi } from '@/lib/supabase';
import { invalidateTasks } from '@/lib/task-queries';
import type { Task } from '@do-done/shared';

/**
 * Deep-link target `dodone://task/<id>` — opens a task's editor directly. Used by
 * home-screen widget rows (and, later, notification taps and "Copy link"). Loads
 * the task by id, then presents the same TaskEditModalV2 used everywhere else;
 * closing returns to wherever you were, or the Today tab on a cold launch.
 */
export default function TaskDeepLinkScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [notFound, setNotFound] = useState(false);

  const close = () => {
    invalidateTasks();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  useEffect(() => {
    if (!id) {
      setNotFound(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const api = await getTasksApi();
      const { data } = await api.getById(id);
      if (cancelled) return;
      if (data) setTask(data);
      else setNotFound(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Bail out to the app if the task is gone (deleted/completed off a stale widget).
  useEffect(() => {
    if (notFound) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notFound]);

  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={close} />
      <TaskEditModalV2 task={task} visible={!!task} onClose={close} />
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
