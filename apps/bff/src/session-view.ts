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

import type { Session } from '@nodedash/shared';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import { isExpired } from './session.ts';

/** The single place the session payload sent to the browser is shaped. */
export function sessionView(request: FastifyRequest, config: Config): Session {
  const identity = request.session.identity;
  const authenticated = Boolean(request.session.unscopedToken && identity) && !isExpired(identity!.expiresAt);

  return {
    authenticated,
    user: authenticated
      ? {
          id: identity!.userId,
          name: identity!.userName,
          displayName: identity!.displayName,
          domainId: identity!.domainId,
          domainName: identity!.domainName,
          idp: identity!.idp,
        }
      : null,
    region: authenticated ? (request.session.region ?? null) : null,
    scope: authenticated ? (request.session.scope ?? null) : null,
    lastScope: authenticated ? (request.session.lastScope ?? null) : null,
    expiresAt: authenticated ? identity!.expiresAt : null,
    identityProviders: config.identityProviders.map((provider) => ({
      id: provider.id,
      protocol: provider.protocol,
      label: provider.label,
    })),
  };
}
