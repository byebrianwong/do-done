/**
 * The Lists tab is a stack, not a screen.
 *
 * That is what lets a list open *inside* the tab — keeping the tab bar, so
 * re-tapping Lists pops back to the index (React Navigation does that for a
 * focused tab holding a stack, which is exactly the "tap again to get out"
 * half of the resume rule). See `lib/tab-resume.ts`.
 */
import React from 'react';
import { Stack } from 'expo-router';

export default function ListsLayout() {
  return (
    <Stack>
      {/* The index draws its own title bar, like every other tab root — but
          it still needs a `title`, because that is what the pushed screen's
          back button is labelled with. Without it the button reads "index",
          the route's filename. */}
      <Stack.Screen
        name="index"
        options={{ headerShown: false, title: 'Lists' }}
      />
      <Stack.Screen name="[id]" options={{ headerShown: true }} />
    </Stack>
  );
}
