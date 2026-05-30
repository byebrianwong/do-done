// Custom bundle entry. Importing `expo-router/entry` for its side effect
// registers the main app root (AppRegistry "main") that MainActivity mounts.
// We then register a SECOND root, "QuickAdd", which the translucent
// QuickAddActivity mounts for the home-screen quick-add widget. Both roots
// share the one ReactHost / JS bundle, so the Supabase session is shared.
import 'expo-router/entry';
import { AppRegistry } from 'react-native';

import QuickAddRoot from './quick-add-root';

AppRegistry.registerComponent('QuickAdd', () => QuickAddRoot);
