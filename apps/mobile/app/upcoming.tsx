import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';

import { setAgendaMode } from '@/lib/view-mode';

/**
 * Deep-link target for the Upcoming widget and launcher shortcut
 * (`dodone://upcoming`), and where the weekly digest's notification lands.
 *
 * Upcoming shares the Agenda tab with Today now, so this sets which half is
 * showing before bouncing there — otherwise the link would land on whichever
 * one the app was last left on, which is usually not the one that was tapped.
 */
export default function UpcomingDeepLink() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setAgendaMode('upcoming');
    setReady(true);
  }, []);
  // One frame of nothing, so the tab is already on Upcoming when it mounts
  // rather than flipping to it a beat after it appears.
  return ready ? <Redirect href="/(tabs)" /> : null;
}
