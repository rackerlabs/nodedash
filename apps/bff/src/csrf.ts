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
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import { HttpError } from './errors.ts';

export const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit CSRF: the token lives in a JavaScript-readable cookie and must be
 * echoed in a header. An attacker's page can trigger a request but cannot read our
 * cookie to set the header.
 *
 * The WebSSO callback is exempt because Keystone posts it and cannot send the
 * header; that route is protected by its own single-use state cookie instead.
 */
export const CSRF_EXEMPT_PATHS = new Set(['/api/auth/websso']);

export function issueCsrfToken(request: FastifyRequest, reply: FastifyReply, config: Config): string {
  const token = request.session.csrfToken ?? randomBytes(24).toString('base64url');
  request.session.csrfToken = token;
  reply.setCookie(CSRF_COOKIE, token, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: config.cookieSecure,
  });
  return token;
}

export function verifyCsrf(request: FastifyRequest): void {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
  if (CSRF_EXEMPT_PATHS.has(new URL(request.url, 'http://localhost').pathname)) return;

  const expected = request.session.csrfToken;
  const provided = request.headers[CSRF_HEADER];
  if (!expected || typeof provided !== 'string' || provided !== expected) {
    throw new HttpError(403, 'forbidden', 'Request rejected: missing or stale CSRF token. Reload the page.');
  }
}
