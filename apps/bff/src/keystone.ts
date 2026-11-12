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

import {
  DomainSchema,
  ProjectSchema,
  RegionSchema,
  type Domain,
  type Project,
  type Region,
} from '@nodedash/shared';
import { z } from 'zod';
import type { Config } from './config.ts';
import { fromUpstream, HttpError, unauthenticated } from './errors.ts';

/** Treat a token as expired this long before Keystone would, to avoid races. */
export const EXPIRY_SKEW_MS = 60_000;

/** Service type Ironic registers under in the Keystone catalog. */
const BAREMETAL_SERVICE_TYPE = 'baremetal';

const CatalogSchema = z.array(
  z.looseObject({
    type: z.string(),
    endpoints: z.array(
      z.looseObject({
        interface: z.string(),
        url: z.string(),
        region_id: z.string().nullish(),
        region: z.string().nullish(),
      }),
    ),
  }),
);

const TokenUserSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  domain: z.looseObject({ id: z.string(), name: z.string().nullish() }).nullish(),
  'OS-FEDERATION': z
    .looseObject({
      identity_provider: z.looseObject({ id: z.string() }).nullish(),
      protocol: z.looseObject({ id: z.string() }).nullish(),
    })
    .nullish(),
});

const TokenBodySchema = z.looseObject({
  token: z.looseObject({
    expires_at: z.string(),
    user: TokenUserSchema,
    project: z
      .looseObject({
        id: z.string(),
        name: z.string(),
        domain: z.looseObject({ id: z.string(), name: z.string().nullish() }).nullish(),
      })
      .nullish(),
    catalog: CatalogSchema.nullish(),
  }),
});

export interface KeystoneIdentity {
  userId: string;
  userName: string;
  displayName: string | null;
  domainId: string | null;
  domainName: string | null;
  idp: string | null;
  expiresAt: string;
}

export interface ScopedToken {
  token: string;
  expiresAtMs: number;
  projectId: string;
  projectName: string;
  domainId: string;
  domainName: string;
  /** Ironic endpoint URL by region id, from this token's service catalog. */
  ironicEndpoints: Record<string, string>;
}

/**
 * The Ironic endpoint a scoped token should talk to in a region. The catalog can
 * differ per project, so this is checked per token rather than once per region.
 */
export function ironicEndpointFor(scoped: ScopedToken, region: string): string {
  const endpoint = scoped.ironicEndpoints[region];
  if (!endpoint) {
    throw new HttpError(
      404,
      'not_found',
      `Project ${scoped.projectName} has no bare metal (Ironic) endpoint in region ${region}.`,
    );
  }
  return endpoint;
}

export class KeystoneClient {
  private readonly config: Config;
  /**
   * Domain id to name. Not per-user state: a domain's name is the same for
   * everyone, and it is only ever looked up for a domain the caller has a project in.
   */
  private readonly domainNameCache = new Map<string, string>();

  constructor(config: Config) {
    this.config = config;
  }

  private async call(
    path: string,
    init: { method?: string; token?: string; subjectToken?: string; body?: unknown } = {},
  ): Promise<{ status: number; headers: Headers; body: unknown; text: string }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.token) headers['X-Auth-Token'] = init.token;
    if (init.subjectToken) headers['X-Subject-Token'] = init.subjectToken;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${this.config.keystoneUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, headers: response.headers, body, text };
  }

  /** Confirms an unscoped token is still good and extracts who it belongs to. */
  async identify(unscopedToken: string): Promise<KeystoneIdentity> {
    const result = await this.call('/v3/auth/tokens?nocatalog', {
      token: unscopedToken,
      subjectToken: unscopedToken,
    });
    if (result.status === 401 || result.status === 404) throw unauthenticated();
    if (result.status >= 400) {
      throw fromUpstream(result.status, 'Keystone rejected the token.', result.text.slice(0, 300));
    }

    const parsed = TokenBodySchema.parse(result.body).token;
    const federation = parsed.user['OS-FEDERATION'];
    return {
      userId: parsed.user.id,
      userName: parsed.user.name,
      displayName: parsed.user.name,
      domainId: parsed.user.domain?.id ?? null,
      domainName: parsed.user.domain?.name ?? null,
      idp: federation?.identity_provider?.id ?? null,
      expiresAt: parsed.expires_at,
    };
  }

  /**
   * Exchanges an unscoped token for a project-scoped one, with its catalog so the
   * caller can find Ironic. Nothing is cached here: the BFF holds no per-user
   * state, and the caller keeps the current project's token in the session cookie.
   */
  async scopedToken(unscopedToken: string, projectId: string): Promise<ScopedToken> {
    const result = await this.call('/v3/auth/tokens', {
      method: 'POST',
      body: {
        auth: {
          identity: { methods: ['token'], token: { id: unscopedToken } },
          scope: { project: { id: projectId } },
        },
      },
    });

    if (result.status === 401) throw unauthenticated();
    if (result.status >= 400) {
      throw fromUpstream(
        result.status,
        'Keystone would not scope your token to that project.',
        result.text.slice(0, 300),
      );
    }

    const token = result.headers.get('x-subject-token');
    if (!token) {
      throw fromUpstream(502, 'Keystone did not return a scoped token.', null);
    }
    const parsed = TokenBodySchema.parse(result.body).token;
    if (!parsed.project) {
      throw fromUpstream(502, 'Keystone returned a token with no project scope.', null);
    }

    return {
      token,
      expiresAtMs: new Date(parsed.expires_at).getTime(),
      projectId: parsed.project.id,
      projectName: parsed.project.name,
      domainId: parsed.project.domain?.id ?? '',
      domainName: parsed.project.domain?.name ?? parsed.project.domain?.id ?? '',
      ironicEndpoints: ironicEndpoints(parsed.catalog ?? [], this.config.ironicInterface),
    };
  }

  /** Every region Keystone knows about. Listing regions needs no particular role. */
  async listRegions(unscopedToken: string): Promise<Region[]> {
    const result = await this.call('/v3/regions', { token: unscopedToken });
    if (result.status === 401) throw unauthenticated();
    if (result.status >= 400) {
      throw fromUpstream(result.status, 'Could not list regions.', result.text.slice(0, 300));
    }
    return z.looseObject({ regions: z.array(RegionSchema) }).parse(result.body).regions;
  }

  async listProjects(unscopedToken: string): Promise<Project[]> {
    const result = await this.call('/v3/auth/projects', { token: unscopedToken });
    if (result.status === 401) throw unauthenticated();
    if (result.status >= 400) {
      throw fromUpstream(result.status, 'Could not list your projects.', result.text.slice(0, 300));
    }
    const parsed = z.looseObject({ projects: z.array(ProjectSchema) }).parse(result.body);
    return parsed.projects.filter((project) => project.enabled !== false);
  }

  async listDomains(unscopedToken: string): Promise<Domain[]> {
    const result = await this.call('/v3/auth/domains', { token: unscopedToken });
    // A user can hold project roles without any domain role, in which case
    // Keystone refuses this call. Domain names are cosmetic, so carry on without.
    if (result.status === 403) return [];
    if (result.status === 401) throw unauthenticated();
    if (result.status >= 400) {
      throw fromUpstream(result.status, 'Could not list domains.', result.text.slice(0, 300));
    }
    return z.looseObject({ domains: z.array(DomainSchema) }).parse(result.body).domains;
  }

  /**
   * Names the domains of the given projects. /v3/auth/domains only covers
   * domains the user holds a role on, but a token scoped to a project carries its
   * domain's name, so the rest are named by scoping to one project in each. A
   * domain that cannot be named that way keeps its id as its name.
   */
  async nameDomains(unscopedToken: string, projects: Project[]): Promise<Domain[]> {
    const firstProject = new Map<string, string>();
    for (const project of projects) {
      if (!firstProject.has(project.domain_id)) firstProject.set(project.domain_id, project.id);
    }

    const unnamed = () => [...firstProject.keys()].filter((id) => !this.domainNameCache.has(id));
    if (unnamed().length > 0) {
      for (const domain of await this.listDomains(unscopedToken)) {
        this.domainNameCache.set(domain.id, domain.name);
      }
    }
    await Promise.all(
      unnamed().map(async (domainId) => {
        try {
          const scoped = await this.scopedToken(unscopedToken, firstProject.get(domainId) as string);
          if (scoped.domainId === domainId && scoped.domainName !== domainId) {
            this.domainNameCache.set(domainId, scoped.domainName);
          }
        } catch {
          // Cosmetic only: the id stands in for the name.
        }
      }),
    );

    return [...firstProject.keys()].map((id) => ({ id, name: this.domainNameCache.get(id) ?? id }));
  }

  /** Best-effort revocation on sign-out; failures must not block the logout. */
  async revoke(token: string): Promise<void> {
    try {
      await this.call('/v3/auth/tokens', { method: 'DELETE', token, subjectToken: token });
    } catch {
      // Token will expire on its own.
    }
  }
}

/** Picks Ironic's URL in each region out of a token's catalog, for one interface. */
export function ironicEndpoints(
  catalog: z.infer<typeof CatalogSchema>,
  wantedInterface: string,
): Record<string, string> {
  const endpoints: Record<string, string> = {};
  for (const service of catalog) {
    if (service.type !== BAREMETAL_SERVICE_TYPE) continue;
    for (const endpoint of service.endpoints) {
      // region_id is the v3 field; region is its deprecated v2-era twin.
      const region = endpoint.region_id ?? endpoint.region;
      if (endpoint.interface !== wantedInterface || !region) continue;
      endpoints[region] = endpoint.url.replace(/\/$/, '');
    }
  }
  return endpoints;
}
