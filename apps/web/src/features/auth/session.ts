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
import type { Session } from '@nodedash/shared';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';

export function useSession() {
  return useQuery({
    queryKey: qk.session,
    queryFn: () => api.session(),
    staleTime: 30_000,
  });
}

export function useCapabilities() {
  const session = useSession();
  const region = session.data?.region ?? null;
  const projectId = session.data?.scope?.projectId ?? null;
  return useQuery({
    queryKey: qk.capabilities(region, projectId),
    queryFn: () => api.capabilities(),
    // The BFF needs a project to find the region's Ironic in the catalog.
    enabled: Boolean(region && projectId),
    // Microversion support only changes when the server is upgraded.
    staleTime: 10 * 60_000,
  });
}

export function useRegions(enabled = true) {
  return useQuery({
    queryKey: qk.regions,
    queryFn: () => api.regions(),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useSetRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (region: string) => api.setRegion(region),
    onSuccess: (session: Session) => {
      queryClient.setQueryData(qk.session, session);
      // A new region means a different Ironic: nothing node-shaped carries over.
      void queryClient.invalidateQueries({ queryKey: ['nodes'] });
      void queryClient.invalidateQueries({ queryKey: ['node'] });
      void queryClient.invalidateQueries({ queryKey: ['runbooks'] });
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idp, next }: { idp: string; next: string }) => api.beginLogin(idp, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.session }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => queryClient.clear(),
  });
}

export function useSetScope() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => api.setScope(projectId),
    onSuccess: (session: Session) => {
      queryClient.setQueryData(qk.session, session);
      // Node data is scoped to a project, so nothing fetched before survives.
      void queryClient.invalidateQueries({ queryKey: ['nodes'] });
      void queryClient.invalidateQueries({ queryKey: ['node'] });
    },
  });
}
