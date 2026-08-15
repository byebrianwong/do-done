// Custom bundle entry. Importing `expo-router/entry` for its side effect
// registers the main app root (AppRegistry "main") that MainActivity mounts.
// We then register a SECOND root, "QuickAdd", which the translucent
// QuickAddActivity mounts for the home-screen quick-add widget. Both roots
// share the one ReactHost / JS bundle, so the Supabase session is shared.
import 'expo-router/entry';
import { AppRegistry, Platform } from 'react-native';

import QuickAddRoot from './quick-add-root';
import { IS_EXPO_GO } from './lib/runtime';

// Defines the geofence background task, for exactly the reason spelled out
// below for the widget handler.
//
// `TaskManager.defineTask` names a JS entry point the OS looks up **by name**
// when it detects a boundary crossing — and it delivers that event by starting
// the runtime with no activity and no React tree. A task not defined by then
// isn't queued, it's dropped.
//
// The definition used to live in `lib/geofencing.ts`, which is only ever
// imported from `app/_layout.tsx` and two components. Expo Router loads route
// modules through `require.context`'s lazy getters, so none of them had
// evaluated when the event arrived. Location reminders therefore worked only
// while the app was already open and rendered, and never in the case the
// feature exists for: phone in a pocket, app closed, walking into a shop.
//
// `lib/geofence-task.ts` holds nothing but the task and keeps Supabase behind a
// dynamic import, so this costs a couple of native module handles on the cold
// starts that aren't geofence events — including the headless widget ones.
import './lib/geofence-task';

AppRegistry.registerComponent('QuickAdd', () => QuickAddRoot);

// The widget task handler MUST be registered here, at bundle evaluation, and
// nowhere else.
//
// `registerWidgetTaskHandler` is `AppRegistry.registerHeadlessTask` — it names
// the JS entry point the launcher's widget update runs. That update arrives via
// a headless worker that calls `reactHost.start()` when the app is dead, so the
// bundle is evaluated with NO activity and NO React tree. Anything registered
// from a component, or from a module a component pulls in, has not run yet: the
// task key is unregistered, the render never happens, and the widget is left
// showing its empty initial layout — a completely invisible tile on the home
// screen, with no error anywhere the user can see.
//
// This lived in `app/_layout.tsx` until it bit us. Expo Router's route modules
// load through `require.context`, whose entries are lazy getters, so a layout
// only evaluates when the router renders it. The widget therefore drew only
// while the app happened to be warm and rendered — and was invisible whenever it
// was added, resized, or ticked with the app closed.
if (Platform.OS === 'android' && !IS_EXPO_GO) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      registerWidgetTaskHandler,
    } = require('react-native-android-widget');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { widgetTaskHandler } = require('./widgets/widget-task-handler');
    registerWidgetTaskHandler(widgetTaskHandler);
  } catch (err) {
    // Native module missing (Expo Go) — widgets are inert there anyway. Loud in
    // dev because every other symptom of this failing is silent.
    if (__DEV__) {
      console.warn('[widgets] task handler not registered:', err);
    }
  }
}
