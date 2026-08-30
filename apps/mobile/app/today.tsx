import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';

import { setAgendaMode } from '@/lib/view-mode';

/**
 * Deep-link target for the Today widget and launcher shortcut
 * (`dodone://today`), and where the daily digest's notification lands.
 * Sets the Agenda tab to Today first — see `app/upcoming.tsx`.
 */
export default function TodayDeepLink() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setAgendaMode('today');
    setReady(true);
  }, []);
  return ready ? <Redirect href="/(tabs)" /> : null;
}
