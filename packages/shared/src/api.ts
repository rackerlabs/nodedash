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

import { z } from 'zod';
import { DomainSchema, IdentityProviderSchema, ProjectSchema } from './keystone.ts';

/**
 * Contract between the SPA and the BFF. The mock service worker implements the
 * same shapes, so switching between mock and real is a base-URL change.
 */

export const SessionUserSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullish(),
  domainId: z.string().nullish(),
  domainName: z.string().nullish(),
  /** Where the identity came from, shown in the header for federated logins. */
  idp: z.string().nullish(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const ScopeSchema = z.object({
  domainId: z.string(),
  domainName: z.string(),
  projectId: z.string(),
  projectName: z.string(),
});
export type Scope = z.infer<typeof ScopeSchema>;

/** A Keystone region. Ironic endpoints are looked up per region in the service catalog. */
export const RegionSchema = z.object({
  id: z.string(),
  description: z.string().nullish(),
});
export type Region = z.infer<typeof RegionSchema>;

export const RegionListSchema = z.object({
  regions: z.array(RegionSchema),
});
export type RegionList = z.infer<typeof RegionListSchema>;

export const SessionSchema = z.object({
  authenticated: z.boolean(),
  user: SessionUserSchema.nullish(),
  /** Region whose Ironic endpoint every node request goes to. Chosen after sign-in. */
  region: z.string().nullish(),
  scope: ScopeSchema.nullish(),
  /** Most recent scope from a previous visit, used to skip the picker. */
  lastScope: ScopeSchema.nullish(),
  expiresAt: z.string().nullish(),
  identityProviders: z.array(IdentityProviderSchema).default([]),
});
export type Session = z.infer<typeof SessionSchema>;

export const CapabilitiesResponseSchema = z.object({
  serverMaxVersion: z.string().nullable(),
  negotiatedVersion: z.string(),
  capabilities: z.object({
    nodeHistory: z.boolean(),
    inventory: z.boolean(),
    firmware: z.boolean(),
    serviceSteps: z.boolean(),
    runbooks: z.boolean(),
    runbookTraits: z.boolean(),
    graphicalConsole: z.boolean(),
  }),
});
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

export const ScopeOptionsSchema = z.object({
  domains: z.array(DomainSchema),
  projects: z.array(ProjectSchema),
  /** True when the project list was truncated and search must hit the server. */
  truncated: z.boolean().default(false),
});
export type ScopeOptions = z.infer<typeof ScopeOptionsSchema>;

export const LocateResultSchema = z.object({
  found: z.boolean(),
  scope: ScopeSchema.nullish(),
  /** How many projects were checked, so the UI can explain a slow resolve. */
  projectsSearched: z.number().default(0),
});
export type LocateResult = z.infer<typeof LocateResultSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Verbatim upstream message, when there was one. */
    detail: z.string().nullish(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export type ApiErrorCode =
  | 'unauthenticated'
  | 'no_region'
  | 'no_scope'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unsupported'
  | 'upstream_error'
  | 'bad_request';
