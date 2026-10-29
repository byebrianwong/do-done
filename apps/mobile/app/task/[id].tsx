import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import TaskEditModalV2 from '@/components/TaskEditModalV2';
import { getTasksApi } from '@/lib/supabase';
import { cachedTask, invalidateTasks } from '@/lib/task-queries';
import type { Task } from '@do-done/shared';

/**
 * Deep-link target `dodone://task/<id>` — opens a task's editor directly. Used by
 * home-screen widget rows (and, later, notification taps and "Copy link"). Loads
 * the task by id, then presents the same TaskEditModalV2 used everywhere else;
 * closing returns to wherever you were, or the Today tab on a cold launch.
 *
 * **This screen draws no dim of its own.** The editor's backdrop already dims
 * the screen, and follows the sheet as it rises, is dragged and closes. A
 * second 40% layer here stacked to about 64%, faded in alone while the task
 * loaded, and faded out as a separate step after the sheet had gone. The
 * Pressable below is only a transparent tap target for the loading moment.
 *
 * **The task comes from the query cache when it is there**, so the sheet starts
 * to rise on the first frame. A warm app nearly always has it: a widget row or
 * a notification names a task some list has already loaded. Only a miss waits
 * for the fetch.
 */
export default function TaskDeepLinkScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(() => (id ? cachedTask(id) : null));
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
    // Seeded from the cache: the editor has already opened on that row, and it
    // roots itself on the id, so a fetched copy would not reach it anyway.
    if (task?.id === id) return;
    const hit = cachedTask(id);
    if (hit) {
      setTask(hit);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Bail out to the app if the task is gone (deleted/completed off a stale widget).
  useEffect(() => {
    if (notFound) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notFound]);

  return (
    <View style={styles.root}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={close}
        accessibilityLabel="Close"
      />
      <TaskEditModalV2 task={task} visible={!!task} onClose={close} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
});
