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

import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import { issueCsrfToken } from '../csrf.ts';
import { badRequest } from '../errors.ts';
import type { KeystoneClient } from '../keystone.ts';
import { sessionView } from '../session-view.ts';

/**
 * Only same-origin paths are accepted as a post-login destination, so a crafted
 * login link cannot bounce the user to another site after authenticating.
 */
export function sanitizeNext(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return '/nodes';
  return next;
}

export function buildWebssoUrl(config: Config, idpId: string | undefined): string {
  const provider = config.identityProviders.find((candidate) => candidate.id === idpId);
  const protocol = provider?.protocol ?? config.webssoProtocol;
  const origin = encodeURIComponent(config.webssoCallbackUrl);

  // Keystone offers a protocol-wide entry point and a per-IdP one; use the
  // specific one whenever the caller named an IdP we know about.
  return provider
    ? `${config.keystoneUrl}/v3/auth/OS-FEDERATION/identity_providers/${encodeURIComponent(provider.id)}/protocols/${encodeURIComponent(protocol)}/websso?origin=${origin}`
    : `${config.keystoneUrl}/v3/auth/OS-FEDERATION/websso/${encodeURIComponent(protocol)}?origin=${origin}`;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  config: Config,
  keystone: KeystoneClient,
): void {
  app.get('/api/session', async (request, reply) => {
    const view = sessionView(request, config);
    // Hand out a CSRF token alongside the session so the SPA can mutate straight away.
    if (view.authenticated) issueCsrfToken(request, reply, config);
    return view;
  });

  /**
   * Kicks off Keystone WebSSO. The state that ties the two halves together lives
   * in its own short-lived cookie (see server.ts).
   */
  app.get<{ Querystring: { idp?: string; next?: string } }>('/api/auth/login', async (request, reply) => {
    request.websso.nonce = randomBytes(16).toString('base64url');
    request.websso.next = sanitizeNext(request.query.next);
    return reply.redirect(buildWebssoUrl(config, request.query.idp), 302);
  });

  /**
   * Keystone posts the unscoped token here as a form field. That POST is
   * cross-site, so browsers do not send the Lax state cookie with it, and
   * SameSite=None cannot be relied on over plain-HTTP localhost or in Safari.
   * Instead the token is parked in its own encrypted cookie and the browser is
   * sent to the completion step, a top-level GET, which does carry the state.
   */
  app.post<{ Body: { token?: string } }>('/api/auth/websso', async (request, reply) => {
    const token = request.body?.token;
    if (!token) throw badRequest('Keystone did not return a token.');
    request.webssoPending.token = token;
    return reply.redirect('/api/auth/websso/complete', 303);
  });

  /** Checks the state from /api/auth/login and turns the parked token into a session. */
  app.get('/api/auth/websso/complete', async (request, reply) => {
    const { nonce, next = '/nodes' } = request.websso;
    const token = request.webssoPending.token;
    // Single use: a replayed callback finds no state.
    request.websso.delete();
    request.webssoPending.delete();
    if (!nonce || !token) {
      throw badRequest('Login session expired or was not started here. Start again from the sign-in page.');
    }

    // The token goes straight into the encrypted session cookie, which
    // JavaScript cannot read.
    const identity = await keystone.identify(token);

    // Start from an empty session on every login, so nothing from before sign-in
    // (or from another user on this browser) carries over.
    request.session.regenerate();
    request.session.unscopedToken = token;
    request.session.identity = identity;
    issueCsrfToken(request, reply, config);

    audit(request, { action: 'login', outcome: 'succeeded', detail: { idp: identity.idp } });
    return reply.redirect(sanitizeNext(next), 302);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.session.unscopedToken;
    audit(request, { action: 'logout', outcome: 'succeeded' });

    // There is no server-side session to destroy, so revocation is what makes a
    // copied cookie useless afterwards. The scoped token goes too.
    if (token) await keystone.revoke(token);
    const scopedToken = request.session.scoped?.token;
    if (scopedToken) await keystone.revoke(scopedToken);
    request.session.delete();
    reply.clearCookie('csrf_token', { path: '/' });
    return reply.code(204).send();
  });
}
