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

const KEY = 'nodedash.region';

/**
 * The region last worked in is a per-browser convenience for URLs that name none,
 * so it lives in localStorage; nothing server-side needs it, because every API call
 * names its own region.
 */
export function readLastRegion(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberRegion(region: string): void {
  try {
    window.localStorage.setItem(KEY, region);
  } catch {
    // Private browsing modes can refuse writes; the chooser just asks again.
  }
}
