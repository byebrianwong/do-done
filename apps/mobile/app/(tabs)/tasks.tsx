/**
 * The Tasks tab — everything, with the Inbox behind the swap in its header.
 *
 * The Inbox is a handful of untriaged rows on most days, which never justified
 * a permanent tab; the count rides on this tab's badge instead, so it is still
 * the thing you notice.
 */
import React from 'react';

import { AllView } from '@/components/views/AllView';
import { InboxView } from '@/components/views/InboxView';
import { useViewMode } from '@/lib/view-mode';

export default function TasksTab() {
  const { tasks } = useViewMode();
  return tasks === 'inbox' ? <InboxView /> : <AllView />;
}
