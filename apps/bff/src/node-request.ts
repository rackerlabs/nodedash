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

import type { FastifyRequest } from 'fastify';
import type { IronicTarget } from './ironic.ts';
import { EXPIRY_SKEW_MS, ironicEndpointFor, type KeystoneClient, type ScopedToken } from './keystone.ts';
import { requireScope } from './session.ts';

/**
 * Token and Ironic endpoint for the current project in the region the request
 * names. The scoped token rides in the session cookie, so it is minted once per
 * project rather than on every request, and is replaced shortly before Keystone
 * would reject it.
 */
export async function ironicTarget(keystone: KeystoneClient, request: FastifyRequest): Promise<IronicTarget> {
  const { unscopedToken, scope, region } = requireScope(request);

  const current = request.session.scoped;
  if (current && current.projectId === scope.projectId && current.expiresAtMs - EXPIRY_SKEW_MS > Date.now()) {
    return {
      token: current.token,
      endpoint: ironicEndpointFor(current.ironicEndpoints, scope.projectName, region),
    };
  }

  const scoped = await keystone.scopedToken(unscopedToken, scope.projectId);
  return rememberScopedToken(request, scoped, region);
}

/** Keeps a freshly minted token as the session's current one. */
export function cacheScopedToken(request: FastifyRequest, scoped: ScopedToken): void {
  request.session.scoped = {
    token: scoped.token,
    expiresAtMs: scoped.expiresAtMs,
    projectId: scoped.projectId,
    ironicEndpoints: scoped.ironicEndpoints,
  };
}

/** Caches a freshly minted token and returns its target in the region a request names. */
export function rememberScopedToken(
  request: FastifyRequest,
  scoped: ScopedToken,
  region: string,
): IronicTarget {
  cacheScopedToken(request, scoped);
  return { token: scoped.token, endpoint: ironicEndpointFor(scoped.ironicEndpoints, scoped.projectName, region) };
}

/**
 * Path to a node resource. The uuid comes from the URL, so it is encoded rather
 * than interpolated raw.
 */
export function nodePath(uuid: string, suffix = ''): string {
  return `/v1/nodes/${encodeURIComponent(uuid)}${suffix}`;
}
