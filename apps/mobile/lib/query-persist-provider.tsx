/**
 * `PersistQueryClientProvider`, with the save debounced.
 *
 * TanStack's provider restores the cache once and then calls
 * `persistQueryClientSubscribe`, which dehydrates the whole cache on every
 * cache event. This is the same provider with that one call swapped for
 * `subscribeDebouncedPersist` (see `lib/persist-scheduler.ts`). Everything
 * else is kept as TanStack wrote it:
 *
 * - The restore runs once, through `persistQueryClientRestore`, so `maxAge`,
 *   the buster and the persister's own `restoreClient` (where the owner check
 *   lives) behave exactly as before.
 * - `IsRestoringProvider` is true until the restore settles. Queries neither
 *   fetch nor subscribe until then, which is what lets the first frame after
 *   the restore show the rows the user last saw.
 * - Saving starts only after the restore, so a half-restored cache is never
 *   written over the snapshot it is being read from.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  IsRestoringProvider,
  QueryClientProvider,
  type QueryClient,
} from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSave,
  type PersistQueryClientOptions,
} from '@tanstack/react-query-persist-client';

import { subscribeDebouncedPersist } from './persist-scheduler';

/** Flush on `background` and on iOS's `inactive`, which comes first. */
function onAppBackground(flush: () => void): () => void {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') flush();
  });
  return () => sub.remove();
}

export function DebouncedPersistQueryClientProvider({
  client,
  persistOptions,
  children,
}: {
  client: QueryClient;
  persistOptions: Omit<PersistQueryClientOptions, 'queryClient'>;
  children: React.ReactNode;
}) {
  const [isRestoring, setIsRestoring] = useState(true);
  const options = useRef(persistOptions);
  options.current = persistOptions;
  const didRestore = useRef(false);

  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    persistQueryClientRestore({ ...options.current, queryClient: client })
      // A failed restore has already dropped the snapshot; the app starts
      // from an empty cache, which every screen handles.
      .catch(() => {})
      .finally(() => setIsRestoring(false));
  }, [client]);

  useEffect(() => {
    if (isRestoring) return;
    return subscribeDebouncedPersist({
      queryClient: client,
      save: () =>
        persistQueryClientSave({ ...options.current, queryClient: client }),
      onBackground: onAppBackground,
    });
  }, [client, isRestoring]);

  return (
    <QueryClientProvider client={client}>
      <IsRestoringProvider value={isRestoring}>{children}</IsRestoringProvider>
    </QueryClientProvider>
  );
}
