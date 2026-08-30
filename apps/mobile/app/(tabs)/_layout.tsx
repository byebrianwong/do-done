import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import MinimizingTabBar from '@/components/MinimizingTabBar';
import { TabBarMinimizeProvider } from '@/lib/tab-bar-minimize';
import { useInboxTasks } from '@/lib/task-queries';
import { toggleAgendaMode, toggleTasksMode, useViewMode } from '@/lib/view-mode';

const TINT_COLOR = '#6366f1';

/**
 * Re-tapping Lists or Projects goes back up to that tab's index.
 *
 * Spelled out rather than left to the navigator. React Navigation's JS bottom
 * tabs only pop a nested stack automatically through `popToTopOnBlur`, which
 * is the *unstable* native navigator's option and is about blur rather than a
 * press — so the gesture this design leans on would have been an undocumented
 * default we happened to be getting. `navigate` at an already-open screen pops
 * back to it, and is a no-op when the index is already what's showing.
 */
function popToIndex(
  navigation: { navigate: (name: string, params?: object) => void },
  tab: 'lists' | 'projects'
): void {
  navigation.navigate(tab, { screen: 'index' });
}

/**
 * Four tabs: Agenda, Tasks, Lists, Projects.
 *
 * **The labels never change; the icon does.** The tab bar answers "where can I
 * go" and the screen's own title answers "where am I" — a map whose labels move
 * under your thumb is a worse map, and now that the header names exactly one
 * view it is already doing that job. So the first two tabs keep one name each
 * and swap only their glyph (star ⟷ calendar, list ⟷ tray) to show which half
 * is showing. "Agenda" is the cover word Today and Upcoming needed; it is the
 * only new vocabulary in the change.
 *
 * **Re-tapping a tab is the second half of every rule.** On the two swap tabs
 * it swaps; on Lists and Projects it pops the stack back to the index (see
 * `popToIndex`). One gesture, always meaning "the other thing here" — and it
 * is what makes remembering a screen safe, because getting out of a resumed
 * one is never more than one tap.
 */
export default function TabLayout() {
  const { agenda, tasks } = useViewMode();
  // Already cached — the Inbox view reads the same query, and the persisted
  // cache means the badge is right on the first frame of a warm start. It is
  // what keeps triage visible now that the Inbox has no tab of its own, so it
  // is withheld on the one screen that would be telling you what you are
  // reading. `useInboxTasks` fetches a page of 50, so this is "50" rather than
  // an exact count past that — a nudge, not an audit.
  const { data: inbox = [] } = useInboxTasks();
  const inboxCount = tasks === 'all' ? inbox.length : 0;

  return (
    // Wraps the navigator rather than sitting inside it, because both halves
    // of the effect need the same shared value: the bar renders it, and every
    // screen's floating add button rides on it.
    <TabBarMinimizeProvider>
      <Tabs
        // The bar shrinks as a list scrolls down. It is a hand-written bar
        // because the height has to be a Reanimated value and the default's is
        // a plain style prop — see `components/MinimizingTabBar.tsx`.
        tabBar={(props) => <MinimizingTabBar {...props} />}
        screenOptions={{
          tabBarActiveTintColor: TINT_COLOR,
          // Each tab renders its own in-content title bar (see the `topBar` in
          // every screen), so the native navigation header would just duplicate
          // it and waste vertical space.
          headerShown: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Agenda',
            tabBarIcon: ({ color, size }) => (
              <Ionicons
                name={agenda === 'upcoming' ? 'calendar' : 'star'}
                size={size}
                color={color}
              />
            ),
          }}
          listeners={({ navigation }) => ({
            tabPress: () => {
              if (navigation.isFocused()) toggleAgendaMode();
            },
          })}
        />
        <Tabs.Screen
          name="tasks"
          options={{
            title: 'Tasks',
            tabBarBadge: inboxCount > 0 ? inboxCount : undefined,
            tabBarIcon: ({ color, size }) => (
              <Ionicons
                name={tasks === 'inbox' ? 'file-tray' : 'list'}
                size={size}
                color={color}
              />
            ),
          }}
          listeners={({ navigation }) => ({
            tabPress: () => {
              if (navigation.isFocused()) toggleTasksMode();
            },
          })}
        />
        <Tabs.Screen
          name="lists"
          options={{
            title: 'Lists',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="cart" size={size} color={color} />
            ),
          }}
          listeners={({ navigation }) => ({
            tabPress: () => {
              if (navigation.isFocused()) popToIndex(navigation, 'lists');
            },
          })}
        />
        <Tabs.Screen
          name="projects"
          options={{
            title: 'Projects',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="folder" size={size} color={color} />
            ),
          }}
          listeners={({ navigation }) => ({
            tabPress: () => {
              if (navigation.isFocused()) popToIndex(navigation, 'projects');
            },
          })}
        />
      </Tabs>
    </TabBarMinimizeProvider>
  );
}
