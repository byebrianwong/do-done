import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';

import DevBanner from '@/components/DevBanner';
import { useColorScheme } from '@/components/useColorScheme';
import { UndoToastProvider } from '@/components/UndoToast';
import { BulkActionBar } from '@/components/BulkActionBar';
import { TaskSelectionProvider } from '@/lib/task-selection';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { queryClient } from '@/lib/query-client';
import { registerUserGeofences } from '@/lib/geofencing';
import { refreshTaskWidgets, repaintQuickAddWidget } from '@/lib/widgets';

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
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <UndoToastProvider>
            <TaskSelectionProvider>
              <RootLayoutNav />
            </TaskSelectionProvider>
          </UndoToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

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
