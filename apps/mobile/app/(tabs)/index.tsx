/**
 * The Agenda tab — Today, and Upcoming behind the swap in its header.
 *
 * Two views, one tab: they answer the same question at two ranges, and giving
 * each its own tab spent a fifth of the bar on the distinction. See
 * `lib/view-mode.tsx` for where the mode lives, and `components/SwapTitle.tsx`
 * for the control, and `components/SwapView.tsx` for how the swap moves.
 */
import React from 'react';

import { TodayView } from '@/components/views/TodayView';
import { UpcomingView } from '@/components/views/UpcomingView';
import { SwapView } from '@/components/SwapView';
import { SWAP_ORDER } from '@/lib/swap-motion';
import { useViewMode, type AgendaMode } from '@/lib/view-mode';

const renderAgenda = (mode: AgendaMode) =>
  mode === 'upcoming' ? <UpcomingView /> : <TodayView />;

export default function AgendaTab() {
  const { agenda } = useViewMode();
  return (
    <SwapView
      tab="agenda"
      mode={agenda}
      order={SWAP_ORDER.agenda}
      render={renderAgenda}
    />
  );
}
