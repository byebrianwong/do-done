/** The Projects tab is a stack, for the reasons in `lists/_layout.tsx`. */
import React from 'react';
import { Stack } from 'expo-router';

import { resumeScreenAnimation } from '@/lib/tab-resume';

export default function ProjectsLayout() {
  return (
    <Stack>
      {/* The index draws its own title bar, like every other tab root — but
          it still needs a `title`, because that is what the pushed screen's
          back button is labelled with. Without it the button reads "index",
          the route's filename. */}
      <Stack.Screen
        name="index"
        options={{ headerShown: false, title: 'Projects' }}
      />
      {/* A restore is pushed with no animation; see `holdIndexBlank` in
          `lib/tab-resume.ts`. */}
      <Stack.Screen
        name="[id]"
        options={({ route }) => ({
          headerShown: true,
          animation: resumeScreenAnimation(
            route.params as Record<string, unknown> | undefined
          ),
        })}
      />
    </Stack>
  );
}
