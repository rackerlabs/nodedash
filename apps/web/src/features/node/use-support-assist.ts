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

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supportsSupportAssist } from '@nodedash/shared';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { useRegion } from '@/lib/paths';

export function useSupportAssistSupported(uuid: string, options: { enabled?: boolean } = {}) {
  const region = useRegion();
  const query = useQuery({
    queryKey: qk.vendorPassthru(region, uuid),
    queryFn: () => api.vendorPassthruMethods(region, uuid),
    enabled: options.enabled ?? true,
    staleTime: 30 * 60_000,
    retry: false,
  });
  return { ...query, supported: supportsSupportAssist(query.data) };
}

export function useSupportAssist(uuid: string, options: { enabled: boolean; taskMonitor: string }) {
  const region = useRegion();
  const queryClient = useQueryClient();
  const key = qk.supportAssist(region, uuid);
  const eula = useQuery({
    queryKey: [...key, 'eula'],
    queryFn: () => api.supportAssistEula(region, uuid),
    enabled: options.enabled,
    retry: false,
  });
  const archives = useQuery({
    queryKey: [...key, 'archives'],
    queryFn: () => api.supportAssistArchives(region, uuid),
    enabled: options.enabled,
    retry: false,
  });
  const job = useQuery({
    queryKey: [...key, 'job', options.taskMonitor],
    queryFn: () => api.supportAssistJob(region, uuid, options.taskMonitor),
    enabled: options.enabled && !!options.taskMonitor,
    retry: false,
    refetchInterval: (query) => (query.state.data?.is_processing && !query.state.error ? 10_000 : false),
    refetchIntervalInBackground: true,
  });
  const completed = !job.data?.is_processing && (job.data?.task_state ?? job.data?.job_state) === 'Completed';
  useEffect(() => {
    if (options.enabled && options.taskMonitor && completed) {
      void queryClient.invalidateQueries({ queryKey: [...qk.supportAssist(region, uuid), 'archives'] });
    }
  }, [queryClient, region, uuid, options.enabled, options.taskMonitor, completed]);
  const start = useMutation({ mutationFn: () => api.startSupportAssist(region, uuid) });
  return { eula, job, start, archives };
}
