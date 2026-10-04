/**
 * "All shopping": the items of every shopping list on one screen, for a shop
 * that sells from more than one of them.
 *
 * A static route beside `[id].tsx`, which Expo Router prefers over the dynamic
 * one, so `/lists/shopping` lands here and every `/lists/<uuid>` still lands
 * there. A list's id is a uuid, so the two can never meet. The same id,
 * `ALL_SHOPPING_ID`, is what the Lists tab remembers and what the launcher
 * shortcut opens (`dodone://lists/shopping`).
 */
import React from 'react';
import { ALL_SHOPPING_ID } from '@do-done/shared';

import { ListDetail } from '@/components/ListDetail';

export default function AllShoppingScreen() {
  return <ListDetail listId={ALL_SHOPPING_ID} />;
}
