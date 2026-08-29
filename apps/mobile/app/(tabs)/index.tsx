/**
 * The Agenda tab — Today, and Upcoming behind the swap in its header.
 *
 * Two views, one tab: they answer the same question at two ranges, and giving
 * each its own tab spent a fifth of the bar on the distinction. See
 * `lib/view-mode.tsx` for where the mode lives, and `components/SwapTitle.tsx`
 * for the control.
 */
import React from 'react';

import { TodayView } from '@/components/views/TodayView';
import { UpcomingView } from '@/components/views/UpcomingView';
import { useViewMode } from '@/lib/view-mode';

export default function AgendaTab() {
  const { agenda } = useViewMode();
  return agenda === 'upcoming' ? <UpcomingView /> : <TodayView />;
}
