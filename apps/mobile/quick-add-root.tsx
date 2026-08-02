/**
 * Standalone React root mounted by the native QuickAddActivity (a translucent
 * Android activity launched from the 1x1 home-screen widget via `dodoneadd://`).
 *
 * This is NOT an expo-router screen — the activity hosts this component directly
 * via AppRegistry ("QuickAdd", registered in index.js). The window is translucent
 * so the live home screen shows through behind the dim scrim; the composer slides
 * up over it, Todoist-style.
 *
 * Dismissal uses BackHandler.exitApp(), which invokes the resumed activity's
 * default back behavior → finishes QuickAddActivity and returns to the launcher.
 * Because the activity runs in its own task (taskAffinity="" in the manifest),
 * this only finishes this surface and never the main app.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  BackHandler,
  Text,
  Linking,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import QuickAddComposer from '@/components/QuickAddComposer';

function dismiss() {
  BackHandler.exitApp();
}

export default function QuickAddRoot() {
  // undefined = still loading the session, null = signed out, Session = signed in
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <View style={styles.fill}>
          <Pressable style={styles.backdrop} onPress={dismiss} />
          {session === undefined ? null : session ? (
            <QuickAddComposer
              defaultStatus="not_started"
              autoFocus
              onCreated={dismiss}
            />
          ) : (
            <View style={styles.signinCard}>
              <Text style={styles.signinText}>Sign in to do-done to add tasks.</Text>
              <Pressable
                style={styles.signinBtn}
                onPress={() => {
                  Linking.openURL('dodone://').catch(() => {});
                  dismiss();
                }}
              >
                <Text style={styles.signinBtnText}>Open do-done</Text>
              </Pressable>
            </View>
          )}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // Transparent so the translucent activity reveals the home screen behind it.
  root: { flex: 1, backgroundColor: 'transparent' },
  fill: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 24, 39, 0.4)',
  },
  signinCard: {
    position: 'absolute',
    bottom: 24,
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  signinText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  signinBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  signinBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
