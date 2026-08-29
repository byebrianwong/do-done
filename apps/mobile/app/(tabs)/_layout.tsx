import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import MinimizingTabBar from '@/components/MinimizingTabBar';
import { TabBarMinimizeProvider } from '@/lib/tab-bar-minimize';

const TINT_COLOR = '#6366f1';

export default function TabLayout() {
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
            title: 'Today',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="star" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="inbox"
          options={{
            title: 'Inbox',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="file-tray" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="upcoming"
          options={{
            title: 'Upcoming',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="calendar" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="all"
          options={{
            title: 'All',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="list" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="projects"
          options={{
            title: 'Projects',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="folder" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </TabBarMinimizeProvider>
  );
}
