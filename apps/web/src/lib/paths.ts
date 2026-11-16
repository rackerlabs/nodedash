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

import { useParams } from 'react-router';

/**
 * The region is part of every app URL, so a link names the Ironic it belongs to
 * and survives being shared. Keystone region ids are free-form, hence the encoding.
 */
export function nodesPath(region: string): string {
  return `/nodes/${encodeURIComponent(region)}`;
}

export function nodePath(region: string, uuid: string, tab = ''): string {
  return `${nodesPath(region)}/${uuid}${tab ? `/${tab}` : ''}`;
}

/** Links for the region in the current URL; only valid beneath the `r/:region` route. */
export function useRegionPaths() {
  const { region = '' } = useParams();
  return {
    region,
    nodes: nodesPath(region),
    node: (uuid: string, tab = '') => nodePath(region, uuid, tab),
  };
}
