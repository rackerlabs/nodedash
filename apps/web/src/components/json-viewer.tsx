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

import { useMemo } from 'react';
import { FilterableText } from '@/components/filterable-text';

/**
 * Raw payload escape hatch. Inventory and plugin data carry far more than any
 * curated view shows, and operators do go looking for a specific key, so keep the
 * whole document available with a line filter.
 */
export function JsonViewer({
  value,
  filterPlaceholder = 'Filter lines…',
}: {
  value: unknown;
  filterPlaceholder?: string;
}) {
  const text = useMemo(() => JSON.stringify(value, null, 2) ?? '', [value]);
  return <FilterableText text={text} filterPlaceholder={filterPlaceholder} />;
}
