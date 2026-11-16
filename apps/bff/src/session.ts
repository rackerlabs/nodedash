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

import type { Session } from '@fastify/secure-session';
import type { Scope } from '@nodedash/shared';
import type { FastifyRequest } from 'fastify';
import { badRequest, noScope, unauthenticated } from './errors.ts';
import type { KeystoneIdentity } from './keystone.ts';

/**
 * The scoped token for the selected project, kept so that every node request does
 * not have to mint a new one from Keystone. A token is good in every region, so it
 * carries the project's Ironic endpoints for all of them and each request picks
 * the one for its own region.
 */
export interface CurrentScopedToken {
  token: string;
  expiresAtMs: number;
  projectId: string;
  /** Ironic endpoint URL by region id, from the token's service catalog. */
  ironicEndpoints: Record<string, string>;
}

declare module '@fastify/secure-session' {
  /**
   * Everything the BFF knows about a user, carried in an encrypted cookie. The
   * BFF itself holds no per-user state, so any replica can serve any request and
   * a restart signs nobody out. The browser stores the cookie but cannot read or
   * alter it: it is HttpOnly and sealed with SESSION_KEYS.
   */
  interface SessionData {
    /** Unscoped Keystone token from WebSSO. */
    unscopedToken: string;
    identity: KeystoneIdentity;
    scope: Scope;
    /** Remembered so deep links and a return visit can skip the project picker. */
    lastScope: Scope;
    scoped: CurrentScopedToken;
    csrfToken: string;
  }
}

/** The WebSSO round trip's state, in its own short-lived encrypted cookie. */
export interface WebssoState {
  nonce: string;
  next: string;
}

/** The token Keystone posted back, held only until the same-site hop that checks the state. */
export interface WebssoPending {
  token: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    websso: Session<WebssoState>;
    webssoPending: Session<WebssoPending>;
  }
}

export interface AuthenticatedSession {
  unscopedToken: string;
  identity: KeystoneIdentity;
}

/**
 * True when a Keystone expiry has passed, or cannot be read at all. An
 * unparsable timestamp must count as expired: comparing NaN would otherwise
 * treat the session as valid indefinitely.
 */
export function isExpired(expiresAt: string, now = Date.now()): boolean {
  const timestamp = new Date(expiresAt).getTime();
  return !Number.isFinite(timestamp) || timestamp <= now;
}

export function requireAuth(request: FastifyRequest): AuthenticatedSession {
  const { unscopedToken, identity } = request.session;
  if (!unscopedToken || !identity) throw unauthenticated();
  if (isExpired(identity.expiresAt)) throw unauthenticated();
  return { unscopedToken, identity };
}

/**
 * The region comes from the request's `:region` route parameter rather than the
 * session, so each request names the Ironic it is for and two tabs on different
 * regions cannot disturb each other. It is not checked against Keystone's region
 * list: a region with no Ironic in the project's catalog fails with a 404 when the
 * endpoint is looked up.
 */
export function requireRegion(request: FastifyRequest): AuthenticatedSession & { region: string } {
  const auth = requireAuth(request);
  const { region } = request.params as { region?: string };
  if (!region) throw badRequest('A region is required.');
  return { ...auth, region };
}

export function requireScope(
  request: FastifyRequest,
): AuthenticatedSession & { region: string; scope: Scope } {
  const auth = requireRegion(request);
  const scope = request.session.scope;
  if (!scope) throw noScope();
  return { ...auth, scope };
}
