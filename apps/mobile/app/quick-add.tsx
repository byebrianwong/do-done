import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import QuickAddBar from '@/components/QuickAddBar';

/**
 * Deep-link target for the "Quick Add" home-screen widget
 * (dodone://quick-add). Presents the quick-add bar over a dimmed backdrop
 * with the input pre-focused, so tapping the widget drops you straight into
 * task capture. Closing returns to wherever you were — or the Today tab on a
 * cold launch where there's no back stack.
 */
export default function QuickAddModal() {
  const router = useRouter();

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={close} />
      <QuickAddBar defaultStatus="not_started" autoFocus onCreated={close} />
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
