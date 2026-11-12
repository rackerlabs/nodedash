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

import { DEFAULT_BRANDING } from '@nodedash/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { buildWebssoUrl, sanitizeNext } from './auth.ts';

const baseEnv = {
  PUBLIC_URL: 'https://nodes.example.invalid',
  KEYSTONE_URL: 'https://keystone.example.invalid/',
  SESSION_KEYS: Buffer.alloc(32, 1).toString('base64'),
  IDENTITY_PROVIDERS: 'corp-sso:saml2:Corp SSO,lab-oidc:openid:Lab OIDC',
};

describe('sanitizeNext', () => {
  it('keeps a same-origin path', () => {
    expect(sanitizeNext('/nodes/abc/inventory?tab=1')).toBe('/nodes/abc/inventory?tab=1');
  });

  it('refuses anything that could leave the site', () => {
    for (const value of [
      '//evil.example/phish',
      'https://evil.example',
      'javascript:alert(1)',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(sanitizeNext(value)).toBe('/nodes');
    }
  });
});

describe('buildWebssoUrl', () => {
  const config = loadConfig({ ...baseEnv } as NodeJS.ProcessEnv);

  it('uses the per-IdP endpoint with that IdP protocol', () => {
    const url = new URL(buildWebssoUrl(config, 'lab-oidc'));
    expect(url.pathname).toBe(
      '/v3/auth/OS-FEDERATION/identity_providers/lab-oidc/protocols/openid/websso',
    );
    expect(url.searchParams.get('origin')).toBe('https://nodes.example.invalid/api/auth/websso');
  });

  it('falls back to the protocol-wide endpoint for an unknown IdP', () => {
    const url = new URL(buildWebssoUrl(config, 'nope'));
    expect(url.pathname).toBe('/v3/auth/OS-FEDERATION/websso/saml2');
  });

  it('strips a trailing slash from the Keystone URL rather than doubling it', () => {
    expect(buildWebssoUrl(config, 'corp-sso')).not.toContain('invalid//v3');
  });

  it('escapes IdP identifiers so a configured value cannot alter the path', () => {
    const hostile = loadConfig({
      ...baseEnv,
      IDENTITY_PROVIDERS: '../../admin:saml2:Hostile',
    } as NodeJS.ProcessEnv);
    expect(new URL(buildWebssoUrl(hostile, '../../admin')).pathname).toBe(
      '/v3/auth/OS-FEDERATION/identity_providers/..%2F..%2Fadmin/protocols/saml2/websso',
    );
  });
});

describe('loadConfig', () => {
  it('derives the WebSSO callback Keystone must trust', () => {
    const config = loadConfig(baseEnv as NodeJS.ProcessEnv);
    expect(config.webssoCallbackUrl).toBe('https://nodes.example.invalid/api/auth/websso');
  });

  it('rejects a session key that is not exactly 32 bytes', () => {
    const short = Buffer.alloc(16, 1).toString('base64');
    expect(() => loadConfig({ ...baseEnv, SESSION_KEYS: short } as NodeJS.ProcessEnv)).toThrow(
      /SESSION_KEYS: key 1 decodes to 16 bytes/,
    );
  });

  it('accepts several session keys, so one can be rotated in front of the other', () => {
    const keys = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)].map((key) => key.toString('base64'));
    const config = loadConfig({ ...baseEnv, SESSION_KEYS: keys.join(', ') } as NodeJS.ProcessEnv);
    expect(config.sessionKeys).toHaveLength(2);
  });

  it('requires a session key', () => {
    expect(() => loadConfig({ ...baseEnv, SESSION_KEYS: '' } as NodeJS.ProcessEnv)).toThrow(/SESSION_KEYS/);
  });

  it('takes Ironic from the public catalog interface unless told otherwise', () => {
    expect(loadConfig(baseEnv as NodeJS.ProcessEnv).ironicInterface).toBe('public');
    expect(() => loadConfig({ ...baseEnv, IRONIC_INTERFACE: 'private' } as NodeJS.ProcessEnv)).toThrow(
      /IRONIC_INTERFACE/,
    );
  });

  it('takes branding from BRAND_* and falls back to the defaults', () => {
    expect(loadConfig(baseEnv as NodeJS.ProcessEnv).branding).toEqual(DEFAULT_BRANDING);
    const branded = loadConfig({
      ...baseEnv,
      BRAND_NAME: 'Fleet Console',
      BRAND_TAGLINE: '',
      BRAND_LOGO_URL: '/brand/logo.svg',
    } as NodeJS.ProcessEnv);
    expect(branded.branding).toEqual({ name: 'Fleet Console', tagline: '', logoUrl: '/brand/logo.svg' });
  });

  it('refuses a logo URL that is not http(s) or a same-origin path', () => {
    for (const logo of ['javascript:alert(1)', '//evil.example/logo.svg', 'logo.svg']) {
      expect(() => loadConfig({ ...baseEnv, BRAND_LOGO_URL: logo } as NodeJS.ProcessEnv)).toThrow(/BRAND_LOGO_URL/);
    }
  });

  it('defaults an IdP protocol to WEBSSO_PROTOCOL when the entry omits one', () => {
    const config = loadConfig({
      ...baseEnv,
      WEBSSO_PROTOCOL: 'openid',
      IDENTITY_PROVIDERS: 'bare-idp',
    } as NodeJS.ProcessEnv);
    expect(config.identityProviders).toEqual([{ id: 'bare-idp', protocol: 'openid', label: 'bare-idp' }]);
  });
});
