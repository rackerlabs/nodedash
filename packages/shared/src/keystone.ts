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

export const DomainSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  enabled: z.boolean().nullish(),
});
export type Domain = z.infer<typeof DomainSchema>;

export const ProjectSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  domain_id: z.string(),
  description: z.string().nullish(),
  enabled: z.boolean().nullish(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListSchema = z.looseObject({
  projects: z.array(ProjectSchema),
});

export const DomainListSchema = z.looseObject({
  domains: z.array(DomainSchema),
});

export const IdentityProviderSchema = z.looseObject({
  id: z.string(),
  /** WebSSO protocol to use for this IdP, e.g. "saml2" or "openid". */
  protocol: z.string(),
  label: z.string().nullish(),
});
export type IdentityProvider = z.infer<typeof IdentityProviderSchema>;
