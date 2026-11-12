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

import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import secureSession from '@fastify/secure-session';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { loadConfig } from './config.ts';
import { verifyCsrf } from './csrf.ts';
import { HttpError } from './errors.ts';
import { IronicClient } from './ironic.ts';
import { KeystoneClient } from './keystone.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerDiagnosticsRoutes } from './routes/diagnostics.ts';
import { registerNodeRoutes } from './routes/nodes.ts';
import { registerSupportAssistRoutes } from './routes/support-assist.ts';
import { registerScopeRoutes } from './routes/scope.ts';

/** How long a sign-in may take between leaving for the IdP and Keystone posting back. */
const WEBSSO_STATE_TTL_SECONDS = 600;
/** Covers only the redirect from the callback to its completion step. */
const WEBSSO_PENDING_TTL_SECONDS = 60;

export async function buildServer() {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers["x-auth-token"]', 'req.headers.cookie', 'req.headers.authorization'],
    },
    trustProxy: config.trustProxy,
  });

  const sessionTtlSeconds = Math.floor(config.sessionTtlMs / 1000);

  await app.register(cookie);
  await app.register(formbody);
  await app.register(secureSession, [
    {
      // The whole session lives in this cookie, encrypted and authenticated with
      // SESSION_KEYS, so the BFF holds no per-user state. HttpOnly keeps the
      // Keystone tokens inside it away from JavaScript.
      sessionName: 'session',
      cookieName: 'nodedash_session',
      key: config.sessionKeys,
      expiry: sessionTtlSeconds,
      cookie: {
        path: '/',
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        maxAge: sessionTtlSeconds,
      },
    },
    {
      // WebSSO state. Lax, like the session cookie: the cross-site POST from
      // Keystone never needs it, because the check happens on the same-site
      // redirect that follows (see /api/auth/websso in routes/auth.ts).
      sessionName: 'websso',
      cookieName: 'websso_state',
      key: config.sessionKeys,
      expiry: WEBSSO_STATE_TTL_SECONDS,
      cookie: {
        path: '/api/auth',
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        maxAge: WEBSSO_STATE_TTL_SECONDS,
      },
    },
    {
      // The token Keystone posted, carried across that redirect. Browsers accept a
      // Lax cookie set by a top-level navigation even when it arrived cross-site.
      sessionName: 'webssoPending',
      cookieName: 'websso_pending',
      key: config.sessionKeys,
      expiry: WEBSSO_PENDING_TTL_SECONDS,
      cookie: {
        path: '/api/auth',
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        maxAge: WEBSSO_PENDING_TTL_SECONDS,
      },
    },
  ]);

  const keystone = new KeystoneClient(config);
  const ironic = new IronicClient(config);

  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/')) verifyCsrf(request);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      if (error.status >= 500) request.log.error({ err: error }, 'upstream failure');
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message, detail: error.detail ?? null } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      error: { code: 'upstream_error', message: 'Unexpected server error.', detail: null },
    });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  registerAuthRoutes(app, config, keystone);
  registerScopeRoutes(app, config, keystone);
  registerNodeRoutes(app, config, keystone, ironic);
  registerSupportAssistRoutes(app, config, keystone, ironic);
  registerDiagnosticsRoutes(app, keystone, ironic);

  if (config.staticDir) {
    await app.register(fastifyStatic, { root: config.staticDir });
    // The SPA owns client-side routing, so unknown non-API paths return index.html.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply
          .code(404)
          .send({ error: { code: 'not_found', message: 'No such endpoint.', detail: null } });
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, config };
}

// Only listen when run directly; tests import buildServer instead.
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const { app, config } = await buildServer();
  app.log.info(
    {
      keystone: config.keystoneUrl,
      ironicInterface: config.ironicInterface,
      webssoCallback: config.webssoCallbackUrl,
      identityProviders: config.identityProviders.map((provider) => provider.id),
    },
    'starting nodedash BFF',
  );
  await app.listen({ host: config.host, port: config.port });
}
