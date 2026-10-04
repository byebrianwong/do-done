/**
 * One list: a shopping list or a checklist. The screen itself is
 * `components/ListDetail.tsx`, shared with "All shopping" next door.
 */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ListDetail } from '@/components/ListDetail';

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ListDetail listId={String(id)} />;
}
