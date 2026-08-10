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
 *
 * The activity answers two URIs, and the one it was launched with is the only
 * thing that distinguishes them: `dodoneadd://open` (the 1x1 widget and the
 * "Add task" shortcut) puts the keyboard up, `dodoneadd://voice` (the "Voice
 * task" shortcut) starts recording. Same composer either way — a dictated task
 * gets the same chips, the same parser and the same project as a typed one.
 */

import React, { useCallback, useEffect, useState } from 'react';
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
import type { Project, SuggestionIndex, Task } from '@do-done/shared';
import { buildSuggestionIndex } from '@do-done/shared';

import { getProjectsApi, getTasksApi, supabase } from '@/lib/supabase';
import { isVoiceLaunch } from '@/lib/quick-add-launch';
import QuickAddComposer from '@/components/QuickAddComposer';

function dismiss() {
  BackHandler.exitApp();
}


export default function QuickAddRoot() {
  // undefined = still loading the session, null = signed out, Session = signed in
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[] | undefined>(undefined);
  const [suggestionIndex, setSuggestionIndex] = useState<
    SuggestionIndex | undefined
  >(undefined);
  // undefined until the launch URL has been read. The composer must not mount
  // before then: mounting with the default and correcting afterwards would put
  // the keyboard up and then race a permission dialog over it.
  const [voiceLaunch, setVoiceLaunch] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session);
    });
    Linking.getInitialURL()
      .then((url) => {
        if (!cancelled) setVoiceLaunch(isVoiceLaunch(url));
      })
      // No URL is the ordinary "Add task" case, not a failure.
      .catch(() => {
        if (!cancelled) setVoiceLaunch(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The Project chip's list. There is no QueryClientProvider in this root, so
   * it comes straight off ProjectsApi — which is all `useProjects` would have
   * done here anyway. Without this the chip was simply absent from the widget,
   * and a typed `#groceries` silently became a tag on the one surface where it
   * couldn't be a project.
   *
   * The composer renders before this lands; the chip appears when it does,
   * rather than holding the input hostage to a round trip. Capture comes first.
   */
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      const api = await getProjectsApi();
      const { data, error } = await api.list();
      if (!cancelled && !error) setProjects(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  /**
   * The suggestion history, on the same terms as the project list above: no
   * query cache in this root, so it comes straight off TasksApi, and the
   * composer is already on screen before it lands.
   *
   * Read with the same bound as everywhere else rather than a cheaper one
   * tuned for a launcher activity. A shorter history is a *different* history,
   * and this surface would then guess differently from the in-app bar for the
   * same title — exactly the drift the shared scorer exists to prevent.
   *
   * This is also the surface with the most to gain: floating over the home
   * screen there is no view context at all, so nothing else here has any idea
   * which project the task belongs to.
   */
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const api = await getTasksApi();
        const { data, error } = await api.suggestionHistory();
        if (!cancelled && !error) setSuggestionIndex(buildSuggestionIndex(data));
      } catch {
        // A guess is the most optional thing on this surface. Capture works
        // exactly as it did before if the history can't be read.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const createProject = useCallback(
    async (name: string, color: string): Promise<Project | null> => {
      const api = await getProjectsApi();
      const { data, error } = await api.create({ name, color });
      if (error || !data) return null;
      setProjects((prev) => [...(prev ?? []), data]);
      return data;
    },
    []
  );

  /**
   * "More options" from the home screen. The full editor doesn't belong in a
   * translucent activity floating over the launcher — it's a full-screen sheet
   * that wants the router, the query cache and a back stack — so hand the task
   * to the app proper and step out of the way.
   */
  const openInApp = useCallback((task: Task) => {
    Linking.openURL(`dodone://task/${task.id}`).catch(() => {});
    dismiss();
  }, []);

  const ready = session !== undefined && voiceLaunch !== undefined;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <View style={styles.fill}>
          <Pressable style={styles.backdrop} onPress={dismiss} />
          {!ready ? null : session ? (
            <QuickAddComposer
              autoFocus={!voiceLaunch}
              autoRecord={voiceLaunch}
              projects={projects}
              suggestionIndex={suggestionIndex}
              onCreateProject={createProject}
              onExpand={openInApp}
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
