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

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { safeStorageUrl } from './support-assist.ts';

const baseEnv = {
  PUBLIC_URL: 'https://nodes.example.invalid',
  KEYSTONE_URL: 'https://keystone.example.invalid',
  SESSION_KEYS: Buffer.alloc(32, 1).toString('base64'),
};

const open = loadConfig({ ...baseEnv } as NodeJS.ProcessEnv);
const pinned = loadConfig({
  ...baseEnv,
  SUPPORT_ASSIST_STORAGE_HOSTS: 'objects.example.invalid, swift.example.invalid',
} as NodeJS.ProcessEnv);

describe('safeStorageUrl', () => {
  it('passes through an https URL from the conductor', () => {
    expect(safeStorageUrl('https://objects.example.invalid/bundle.tar.gz?sig=abc', open)).toBe(
      'https://objects.example.invalid/bundle.tar.gz?sig=abc',
    );
  });

  it('refuses a missing or unparsable URL rather than redirecting nowhere', () => {
    expect(() => safeStorageUrl(undefined, open)).toThrowError(/did not return a download URL/);
    expect(() => safeStorageUrl('', open)).toThrowError(/did not return a download URL/);
    expect(() => safeStorageUrl('not a url', open)).toThrowError(/could not be parsed/);
  });

  it('refuses schemes that are not http(s), so the redirect cannot be turned into script', () => {
    for (const hostile of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
    ]) {
      expect(() => safeStorageUrl(hostile, open)).toThrowError(/Refusing to redirect/);
    }
  });

  it('honours the storage host allowlist when one is configured', () => {
    expect(safeStorageUrl('https://swift.example.invalid/x', pinned)).toContain('swift.example.invalid');
    expect(() => safeStorageUrl('https://evil.example/x', pinned)).toThrowError(
      /not in SUPPORT_ASSIST_STORAGE_HOSTS/,
    );
  });

  it('matches the allowlist on host, so a lookalike path cannot slip through', () => {
    expect(() =>
      safeStorageUrl('https://evil.example/objects.example.invalid/bundle', pinned),
    ).toThrowError(/not in SUPPORT_ASSIST_STORAGE_HOSTS/);
    // Port is part of the host: a different port is a different endpoint.
    expect(() => safeStorageUrl('https://swift.example.invalid:9000/x', pinned)).toThrowError(
      /not in SUPPORT_ASSIST_STORAGE_HOSTS/,
    );
  });
});
