/*
Copyright 2026 Rackspace Technology.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { useQuery } from '@tanstack/react-query';
import { toNodeRow, type NodeRow } from '@nodedash/shared';
import { useCallback, useState } from 'react';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';

/** Auto-refresh interval for the fleet view, in ms. */
const NODES_REFRESH_MS = 30_000;

/**
 * Loads the whole node list for the current project. Ironic pages the listing,
 * so this reports how many nodes have arrived while the pages are still walking.
 */
export function useNodes(options: { autoRefresh: boolean }) {
  const session = useSession();
  const projectId = session.data?.scope?.projectId ?? null;
  const [loadedCount, setLoadedCount] = useState(0);

  const onProgress = useCallback((loaded: number) => setLoadedCount(loaded), []);

  const query = useQuery({
    queryKey: qk.nodes(projectId),
    enabled: Boolean(projectId),
    queryFn: ({ signal }) => api.allNodes({ signal, onProgress }),
    select: (nodes): NodeRow[] => nodes.map(toNodeRow),
    refetchInterval: options.autoRefresh ? NODES_REFRESH_MS : false,
  });

  return { query, loadedCount };
}
