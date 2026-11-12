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

import type { Scope } from '@nodedash/shared';

const KEY = 'nodedash.recent-scopes';
const MAX = 6;

/**
 * Recent scopes are a per-browser convenience, so they live in localStorage
 * rather than the session; the server separately remembers the single last
 * scope for deep-link resolution.
 */
export function readRecentScopes(): Scope[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Scope =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Scope).projectId === 'string' &&
        typeof (entry as Scope).projectName === 'string',
    );
  } catch {
    return [];
  }
}

export function rememberScope(scope: Scope): void {
  const next = [scope, ...readRecentScopes().filter((entry) => entry.projectId !== scope.projectId)].slice(
    0,
    MAX,
  );
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing modes can refuse writes; recents are not worth failing over.
  }
}

/**
 * Drops a recent entry. Called when scoping to it fails, which happens when a
 * project has been deleted or the user's access to it was revoked.
 */
export function forgetScope(projectId: string): Scope[] {
  const next = readRecentScopes().filter((entry) => entry.projectId !== projectId);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignored for the same reason as in rememberScope.
  }
  return next;
}
