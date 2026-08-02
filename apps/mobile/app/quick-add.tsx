import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import QuickAddComposer from '@/components/QuickAddComposer';
import { useProjects } from '@/lib/task-queries';

/**
 * In-app deep-link target (`dodone://quick-add`). Presents the same
 * QuickAddComposer used by the home-screen widget over a dimmed backdrop with
 * the input pre-focused. Closing returns to wherever you were — or the Today
 * tab on a cold launch where there's no back stack.
 *
 * Unlike the widget's root, this one lives inside the QueryClientProvider, so
 * it can hand the composer the project list its Project chip needs.
 */
export default function QuickAddModal() {
  const router = useRouter();
  const { data: projects } = useProjects();

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={close} />
      <QuickAddComposer
        defaultStatus="not_started"
        autoFocus
        projects={projects}
        onCreated={close}
      />
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
