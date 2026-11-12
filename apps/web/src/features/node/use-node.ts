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
import { isTransientProvisionState, type IronicNode, type Session } from '@nodedash/shared';
import { useEffect, useRef, useState } from 'react';
import { useSession, useSetScope } from '@/features/auth/session';
import { rememberScope } from '@/features/scope/recents';
import { isNotFound } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';

/** Poll interval while Ironic is mid-operation on a node. */
const ACTIVE_POLL_MS = 3_000;

/** True while the node is expected to change state without us asking. */
function nodeIsSettling(node: IronicNode | undefined): boolean {
  if (!node) return false;
  return (
    isTransientProvisionState(node.provision_state) ||
    Boolean(node.target_power_state) ||
    Boolean(node.target_provision_state)
  );
}

export type ResolutionPhase = 'resolving' | 'ready' | 'error' | 'unresolvable';

/**
 * Loads a node from a bare UUID, which is how shared links arrive.
 *
 * Order of attempts mirrors what costs the least: the project already scoped,
 * then the project remembered from last visit, then a fan-out across every
 * project the user can see. Only the last one is expensive, and it is only
 * reached when the cheap paths miss.
 */
export function useResolvedNode(uuid: string) {
  const session = useSession();
  const setScope = useSetScope();
  const queryClient = useQueryClient();
  const attempted = useRef({ adopt: false, locate: false });
  const [unresolvable, setUnresolvable] = useState(false);

  const scope = session.data?.scope ?? null;
  const lastScope = session.data?.lastScope ?? null;

  const locate = useMutation({
    mutationFn: () => api.locateNode(uuid),
    onSuccess: (result) => {
      if (!result.found || !result.scope) {
        setUnresolvable(true);
        return;
      }
      const found = result.scope;
      queryClient.setQueryData(qk.session, (previous: Session | undefined) =>
        previous ? { ...previous, scope: found, lastScope: found } : previous,
      );
      rememberScope(found);
      void queryClient.invalidateQueries({ queryKey: qk.node(uuid) });
      void queryClient.invalidateQueries({ queryKey: ['nodes'] });
    },
    onError: () => setUnresolvable(true),
  });

  const node = useQuery({
    queryKey: qk.node(uuid),
    enabled: Boolean(scope),
    queryFn: ({ signal }) => api.node(uuid, signal),
    refetchInterval: (query) => (nodeIsSettling(query.state.data) ? ACTIVE_POLL_MS : false),
    // Operators leave a long service run in a background tab and come back to it,
    // so keep polling while the node is mid-operation even when hidden.
    refetchIntervalInBackground: true,
  });

  // No scope yet: adopt the remembered project, or go straight to the fan-out.
  useEffect(() => {
    if (scope || setScope.isPending || locate.isPending || unresolvable) return;
    if (lastScope && !attempted.current.adopt) {
      attempted.current.adopt = true;
      setScope.mutate(lastScope.projectId);
      return;
    }
    if (!attempted.current.locate) {
      attempted.current.locate = true;
      locate.mutate();
    }
  }, [scope, lastScope, setScope, locate, unresolvable]);

  // Scoped, but the node is not in this project: fan out once.
  useEffect(() => {
    if (!node.isError || !isNotFound(node.error) || attempted.current.locate) return;
    attempted.current.locate = true;
    locate.mutate();
  }, [node.isError, node.error, locate]);

  let phase: ResolutionPhase = 'resolving';
  if (unresolvable) phase = 'unresolvable';
  else if (node.data) phase = 'ready';
  else if (node.isError && !isNotFound(node.error)) phase = 'error';

  return {
    node,
    phase,
    /** True while we are searching other projects for this node. */
    isLocating: locate.isPending,
    projectsSearched: locate.data?.projectsSearched ?? 0,
    retry: () => {
      attempted.current.locate = false;
      setUnresolvable(false);
      void node.refetch();
    },
  };
}

/** Invalidate everything that can change when a node is acted on. */
export function useNodeInvalidator(uuid: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.node(uuid) });
    void queryClient.invalidateQueries({ queryKey: ['nodes'] });
  };
}
