import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import DevBanner from '@/components/DevBanner';
import { useColorScheme } from '@/components/useColorScheme';
import { UndoToastProvider, useUndoToast } from '@/components/UndoToast';
import { BulkActionBar } from '@/components/BulkActionBar';
import { TaskSelectionProvider } from '@/lib/task-selection';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { queryClient } from '@/lib/query-client';
import { persistOptions } from '@/lib/query-persist';
import { registerUserGeofences } from '@/lib/geofencing';
import { startDigestScheduling } from '@/lib/digests';
import {
  ensureChannels,
  getNotifications,
  installNotificationHandler,
} from '@/lib/notifications';
import { routeForNotification } from '@/lib/notification-routing';
import { refreshTaskWidgets, repaintQuickAddWidget } from '@/lib/widgets';
import { startStatusSyncSweeps } from '@/lib/status-sync';
import { setAutoSyncNotifier } from '@/lib/auto-sync-notice';
import {
  loadCompletionStreak,
  resetCompletionStreak,
} from '@/lib/completion-streak';

// NOTE: the widget task handler is registered in `index.js`, the bundle entry —
// deliberately not here. The launcher's widget update runs headlessly, with no
// activity and no React tree, so a route module like this one has not been
// evaluated by then. Registering from here left the widgets blank whenever the
// app was closed. See the comment in index.js.

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Restores the last-seen task lists from AsyncStorage before the first
          frame, so launch opens on yesterday's rows instead of on an empty
          screen. Anything older than a day is dropped rather than shown — see
          lib/query-persist.ts. */}
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={persistOptions}
      >
        <AuthProvider>
          <UndoToastProvider>
            <TaskSelectionProvider>
              <RootLayoutNav />
            </TaskSelectionProvider>
          </UndoToastProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  // Point `lib/`'s automatic-change notices at the live toast. Kept in a ref
  // and installed once: the toast context's value is a fresh object on every
  // provider render, and the provider re-renders whenever any toast goes up,
  // so naming it as a dependency would re-install on every toast.
  const toast = useUndoToast();
  const showToast = useRef(toast.show);
  showToast.current = toast.show;
  useEffect(
    () => setAutoSyncNotifier((message) => showToast.current({ message })),
    []
  );

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = (segments[0] as string) === '(auth)';
    if (!session && !inAuthGroup) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace('/(auth)/login' as any);
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments, router]);

  // Re-register geofences whenever the user signs in. Silent by design: this
  // never prompts for location, it only re-arms regions for users who already
  // have saved locations and have already granted access.
  useEffect(() => {
    if (session?.user && Platform.OS !== 'web') {
      registerUserGeofences().catch(() => {
        // ignore — user may have denied permissions
      });
    }
  }, [session?.user]);

  // Refresh home-screen widgets on launch and on sign-in/out, so they reflect
  // current state (and the signed-out placeholder) without waiting for their
  // ~30-minute update tick. No-op off Android / in Expo Go.
  useEffect(() => {
    refreshTaskWidgets();
  }, [session?.user?.id]);

  // Repaint the static Quick Add tile once per launch. It has
  // `updatePeriodMillis: 0`, so if its one render ever failed — an OS-killed
  // headless task, a launcher that added it before the app was installed
  // properly — nothing would ever redraw it and it would sit invisible forever.
  // Opening the app heals it.
  useEffect(() => {
    void repaintQuickAddWidget();
  }, []);

  // Read the recent completion history once per signed-in session, so a row
  // can answer "does ticking this off keep my streak alive?" on the frame of
  // the tap rather than after a round-trip. Keyed on the account, and cleared
  // on the way out — the next user must not inherit the last one's streak.
  useEffect(() => {
    if (!session?.user) {
      resetCompletionStreak();
      return;
    }
    void loadCompletionStreak();
    return resetCompletionStreak;
  }, [session?.user?.id]);

  // Catch tasks whose scheduled day arrived while the app was closed. No-op
  // unless the user has switched the rule on, and only ever once per day.
  useEffect(() => {
    if (!session?.user) return;
    return startStatusSyncSweeps();
  }, [session?.user?.id]);

  // Arm the daily/weekly digests, and re-arm on every return to the
  // foreground. A local notification's text is frozen when it's scheduled, so
  // the re-arm is what keeps tomorrow's digest describing tomorrow's list
  // rather than the one that was there when the app was last opened. No-op
  // unless the user switched a digest on. See lib/digest-plan.ts.
  useEffect(() => {
    if (!session?.user) return;
    return startDigestScheduling();
  }, [session?.user?.id]);

  // Show notifications that fire while the app is on screen, and make sure both
  // Android channels exist.
  //
  // Once per launch, and here rather than at module scope in the background
  // task: both are concerns of a *running* app, and doing them at bundle
  // evaluation would load expo-notifications on every headless cold start too.
  // Without the handler, a notification arriving while DoDone is open is
  // swallowed — which is exactly the case when you walk into the shop holding
  // the phone. Channels are re-asserted on every launch so a user who granted
  // permission in an older build (before a channel existed, or before it had
  // the right importance) still ends up with a correctly configured one.
  useEffect(() => {
    installNotificationHandler();
    void ensureChannels();
  }, []);

  // Where a tapped notification lands.
  //
  // Without this the app opens on whatever screen it was last showing, which
  // throws away the one thing the notification was carrying — most obviously
  // for a location reminder, whose body *is* a task title. Registered here
  // rather than in the geofence task because responding to a tap needs the
  // router, which needs the React tree the background task doesn't have.
  useEffect(() => {
    const N = getNotifications();
    if (!N) return;
    const sub = N.addNotificationResponseReceivedListener(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response: any) => {
        const path = routeForNotification(
          response?.notification?.request?.content?.data
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (path) router.push(path as any);
      }
    );
    return () => sub.remove();
  }, [router]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="completed" options={{ title: 'Completed' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="locations" options={{ title: 'Saved places' }} />
        <Stack.Screen
          name="calendars"
          options={{ title: 'Calendars to show' }}
        />
        <Stack.Screen
          name="status-sync"
          options={{ title: 'Status and schedule' }}
        />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="search" options={{ headerShown: false }} />
        <Stack.Screen name="projects/[id]" options={{ headerShown: true }} />
        <Stack.Screen name="today" options={{ headerShown: false }} />
        <Stack.Screen
          name="quick-add"
          options={{
            presentation: 'transparentModal',
            headerShown: false,
            animation: 'fade',
          }}
        />
        <Stack.Screen
          name="task/[id]"
          options={{
            presentation: 'transparentModal',
            headerShown: false,
            animation: 'fade',
          }}
        />
      </Stack>
      <DevBanner />
      {/* Global overlay: docks over the tab bar whenever rows are multi-selected. */}
      <BulkActionBar />
    </ThemeProvider>
  );
}
