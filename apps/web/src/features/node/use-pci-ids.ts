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
import { parsePciIds } from '@nodedash/shared';

/**
 * The PCI ID database, parsed once per page load. It is 1.7 MB of text, so it is
 * imported on demand (its own chunk) rather than shipped with the app, and only
 * the Inventory tab asks for it. Until it arrives, devices show their raw ids.
 */
export function usePciIds() {
  return useQuery({
    queryKey: ['pci-ids'],
    queryFn: async () => parsePciIds((await import('@/data/pci.ids?raw')).default),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}
