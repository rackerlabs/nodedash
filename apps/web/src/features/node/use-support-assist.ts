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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isSupportAssistActive,
  supportsSupportAssist,
  type SupportAssistCollection,
  type SupportAssistStartRequest,
} from '@nodedash/shared';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';

/**
 * A collection runs for around half an hour, so polling is deliberately unhurried:
 * often enough that progress visibly moves, rare enough that thirty minutes of it
 * is not thousands of requests.
 */
const ACTIVE_POLL_MS = 10_000;

/**
 * Whether this node's driver offers the SupportAssist passthru at all. Driven by
 * the node's own vendor passthru methods rather than the API microversion, because
 * that is what actually decides it.
 */
export function useSupportAssistSupported(uuid: string, options: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: qk.vendorPassthru(uuid),
    queryFn: () => api.vendorPassthruMethods(uuid),
    // Held back until the node has resolved: asking before a project is selected
    // would fail, and this query does not retry.
    enabled: options.enabled ?? true,
    // Driver capabilities do not change under us; no need to re-ask.
    staleTime: 30 * 60_000,
    retry: false,
  });
  return {
    supported: supportsSupportAssist(query.data),
    isPending: query.isPending,
  };
}

export function useSupportAssist(uuid: string, options: { enabled: boolean }) {
  const client = useQueryClient();

  const query = useQuery({
    queryKey: qk.supportAssist(uuid),
    queryFn: () => api.supportAssist(uuid),
    enabled: options.enabled,
    refetchInterval: (result) =>
      (result.state.data?.collections ?? []).some((collection) =>
        isSupportAssistActive(collection.state),
      )
        ? ACTIVE_POLL_MS
        : false,
    // Progress should keep advancing while the operator works in another tab.
    refetchIntervalInBackground: true,
  });

  const start = useMutation({
    mutationFn: (request: SupportAssistStartRequest) => api.startSupportAssist(uuid, request),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.supportAssist(uuid) }),
  });

  return { query, start };
}

export function activeCollection(
  collections: readonly SupportAssistCollection[] | undefined,
): SupportAssistCollection | null {
  return collections?.find((collection) => isSupportAssistActive(collection.state)) ?? null;
}
