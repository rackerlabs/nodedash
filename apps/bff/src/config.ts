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

import { isAbsolute, resolve } from 'node:path';
import { DEFAULT_BRANDING, EXTRA_FIELD_NAME } from '@nodedash/shared';
import { z } from 'zod';

/**
 * All deployment-specific values come from the environment. Nothing about a
 * particular OpenStack region is baked into the image.
 */
const EnvSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(8080),

  /** Public origin this service is reached on; used to build the WebSSO callback. */
  PUBLIC_URL: z.string().url(),
  KEYSTONE_URL: z.string().url(),
  /**
   * Which catalog interface to take the Ironic endpoint from. "public" unless the
   * BFF runs somewhere that should reach Ironic over an internal network.
   */
  IRONIC_INTERFACE: z.enum(['public', 'internal', 'admin']).default('public'),

  /**
   * Comma-separated base64 keys, 32 bytes each, that encrypt the session cookie.
   * The first one encrypts; all of them decrypt, so a new key can be put in front
   * and the old one dropped later without signing everyone out.
   */
  SESSION_KEYS: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
  /** Set to 0 only for local HTTP development. */
  COOKIE_SECURE: z.enum(['0', '1']).default('1'),

  /** Default WebSSO protocol when an IdP does not name one. */
  WEBSSO_PROTOCOL: z.string().default('saml2'),
  /** "id:protocol:label" entries, comma separated. Empty means protocol-only WebSSO. */
  IDENTITY_PROVIDERS: z.string().default(''),

  /** Bound on the cross-project fan-out used to resolve a node UUID. */
  LOCATE_CONCURRENCY: z.coerce.number().int().positive().default(8),
  /** Upper bound on projects returned to the picker before it switches to server search. */
  PROJECT_LIST_LIMIT: z.coerce.number().int().positive().default(2000),
  NODE_PAGE_SIZE: z.coerce.number().int().positive().default(500),
  MAX_NODE_PAGES: z.coerce.number().int().positive().default(40),

  /**
   * Optional `console_type` to request when enabling a console. Leave unset on
   * nodes whose console_interface is already the graphical one — Ironic then
   * returns the VNC proxy URL without being asked. Set it only for deployments
   * where a node exposes both a serial and a graphical console.
   */
  GRAPHICAL_CONSOLE_TYPE: z.string().default(''),

  /**
   * Comma-separated keys of a node's `extra` field the UI may set or change. Any
   * other key is refused, so this is the whole write surface for `extra`. Unset or
   * empty turns editing off.
   */
  EDITABLE_EXTRA_FIELDS: z.string().default(''),

  /** JSON region -> { url, username, password }; inject from a Secret. */
  SUPPORT_ASSIST_ARCHIVES: z
    .string()
    .default('{}')
    .transform((value, ctx) => {
      try {
        const stores = z
          .record(
            z.string(),
            z.object({
              url: z.url().refine((value) => {
                const url = new URL(value);
                return (
                  url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
                );
              }),
              username: z
                .string()
                .min(1)
                .regex(/^[^:\r\n]+$/),
              password: z.string().min(1),
            }),
          )
          .safeParse(JSON.parse(value));
        if (stores.success) return stores.data;
      } catch {
        /* Report the setting name without exposing credentials. */
      }
      ctx.addIssue({
        code: 'custom',
        message: 'Expected a JSON region map with HTTPS url, username and password.',
      });
      return z.NEVER;
    }),

  /** Name shown in the page title, header and sign-in page. */
  BRAND_NAME: z.string().min(1).default(DEFAULT_BRANDING.name),
  BRAND_TAGLINE: z.string().default(DEFAULT_BRANDING.tagline),
  /** Optional logo in place of the default icon: an http(s) URL or a path served alongside the SPA. */
  BRAND_LOGO_URL: z
    .string()
    .regex(/^(https?:\/\/|\/(?!\/))/, 'must be an http(s) URL or start with a single /')
    .optional(),

  /**
   * Requests per client address per window on /api. Counted per replica in memory,
   * so the BFF stays stateless; behind a load balancer the effective ceiling is
   * this times the replica count. Clients are told apart by the address
   * TRUST_PROXY resolves, so many users behind one NAT share a budget.
   */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(6000),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  /** Serve a built SPA from this directory when set. */
  STATIC_DIR: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: z.enum(['0', '1']).default('1'),
});

export interface IdentityProviderConfig {
  id: string;
  protocol: string;
  label: string;
}

function parseIdentityProviders(raw: string, defaultProtocol: string): IdentityProviderConfig[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id = '', protocol = '', label = ''] = entry.split(':');
      return {
        id: id.trim(),
        protocol: protocol.trim() || defaultProtocol,
        label: label.trim() || id.trim(),
      };
    })
    .filter((provider) => provider.id.length > 0);
}

function parseExtraFields(raw: string): string[] {
  const fields = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const bad = fields.find((field) => !EXTRA_FIELD_NAME.test(field));
  if (bad !== undefined) {
    throw new Error(
      `Invalid environment configuration:\n  EDITABLE_EXTRA_FIELDS: "${bad}" may only contain letters, digits, "_", "." and "-"`,
    );
  }
  return [...new Set(fields)];
}

/** libsodium secretbox keys are exactly this long. */
const SESSION_KEY_BYTES = 32;

function parseSessionKeys(raw: string): Buffer[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const key = Buffer.from(entry, 'base64');
      if (key.length !== SESSION_KEY_BYTES) {
        throw new Error(
          `Invalid environment configuration:\n  SESSION_KEYS: key ${index + 1} decodes to ${key.length} bytes, expected ${SESSION_KEY_BYTES}`,
        );
      }
      return key;
    });
}

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const raw = parsed.data;
  const publicUrl = raw.PUBLIC_URL.replace(/\/$/, '');

  return {
    host: raw.HOST,
    port: raw.PORT,
    publicUrl,
    keystoneUrl: raw.KEYSTONE_URL.replace(/\/$/, ''),
    ironicInterface: raw.IRONIC_INTERFACE,
    sessionKeys: parseSessionKeys(raw.SESSION_KEYS),
    sessionTtlMs: raw.SESSION_TTL_HOURS * 3600_000,
    cookieSecure: raw.COOKIE_SECURE === '1',
    webssoProtocol: raw.WEBSSO_PROTOCOL,
    identityProviders: parseIdentityProviders(raw.IDENTITY_PROVIDERS, raw.WEBSSO_PROTOCOL),
    /** Keystone must list this exact URL in `trusted_dashboard`. */
    webssoCallbackUrl: `${publicUrl}/api/auth/websso`,
    locateConcurrency: raw.LOCATE_CONCURRENCY,
    projectListLimit: raw.PROJECT_LIST_LIMIT,
    nodePageSize: raw.NODE_PAGE_SIZE,
    maxNodePages: raw.MAX_NODE_PAGES,
    graphicalConsoleType: raw.GRAPHICAL_CONSOLE_TYPE || null,
    editableExtraFields: parseExtraFields(raw.EDITABLE_EXTRA_FIELDS),
    supportAssistArchives: raw.SUPPORT_ASSIST_ARCHIVES,
    branding: { name: raw.BRAND_NAME, tagline: raw.BRAND_TAGLINE, logoUrl: raw.BRAND_LOGO_URL ?? null },
    // Static file serving needs an absolute root, so resolve it against the cwd.
    staticDir: raw.STATIC_DIR
      ? isAbsolute(raw.STATIC_DIR)
        ? raw.STATIC_DIR
        : resolve(process.cwd(), raw.STATIC_DIR)
      : undefined,
    rateLimitMax: raw.RATE_LIMIT_MAX,
    rateLimitWindowMs: raw.RATE_LIMIT_WINDOW_SECONDS * 1000,
    logLevel: raw.LOG_LEVEL,
    trustProxy: raw.TRUST_PROXY === '1',
  };
}
