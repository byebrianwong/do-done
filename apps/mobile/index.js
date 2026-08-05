// Custom bundle entry. Importing `expo-router/entry` for its side effect
// registers the main app root (AppRegistry "main") that MainActivity mounts.
// We then register a SECOND root, "QuickAdd", which the translucent
// QuickAddActivity mounts for the home-screen quick-add widget. Both roots
// share the one ReactHost / JS bundle, so the Supabase session is shared.
import 'expo-router/entry';
import { AppRegistry, Platform } from 'react-native';

import QuickAddRoot from './quick-add-root';
import { IS_EXPO_GO } from './lib/runtime';

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
