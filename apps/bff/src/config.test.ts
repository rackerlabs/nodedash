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
import { loadConfig } from './config.ts';

const baseEnv = {
  PUBLIC_URL: 'https://nodes.example.invalid',
  KEYSTONE_URL: 'https://keystone.example.invalid',
  SESSION_KEYS: Buffer.alloc(32, 1).toString('base64'),
};

describe('EDITABLE_EXTRA_FIELDS', () => {
  it('is off unless a deployment names fields', () => {
    expect(loadConfig({ ...baseEnv } as NodeJS.ProcessEnv).editableExtraFields).toEqual([]);
  });

  it('trims, drops blanks and duplicates, and can be emptied to turn editing off', () => {
    const env = (value: string) => ({ ...baseEnv, EDITABLE_EXTRA_FIELDS: value }) as NodeJS.ProcessEnv;
    expect(loadConfig(env(' rack, ,rack,row ')).editableExtraFields).toEqual(['rack', 'row']);
    expect(loadConfig(env('')).editableExtraFields).toEqual([]);
  });

  it('refuses a key that could not be a single JSON Patch path segment', () => {
    expect(() =>
      loadConfig({ ...baseEnv, EDITABLE_EXTRA_FIELDS: 'rack,a/b' } as NodeJS.ProcessEnv),
    ).toThrowError(/EDITABLE_EXTRA_FIELDS: "a\/b"/);
  });
});

describe('SUPPORT_ASSIST_ARCHIVES', () => {
  it('requires HTTPS and refuses malformed secret configuration without printing credentials', () => {
    for (const value of [
      'secret-not-json',
      JSON.stringify({
        north1: { url: 'http://cdn.example.invalid/', username: 'reader', password: 'secret-password' },
      }),
      JSON.stringify({
        north1: {
          url: 'https://reader:secret-password@cdn.example.invalid/',
          username: 'reader',
          password: 'secret-password',
        },
      }),
    ]) {
      expect(() => loadConfig({ ...baseEnv, SUPPORT_ASSIST_ARCHIVES: value })).toThrow(
        /SUPPORT_ASSIST_ARCHIVES: Expected/,
      );
      try {
        loadConfig({ ...baseEnv, SUPPORT_ASSIST_ARCHIVES: value });
      } catch (error) {
        expect(String(error)).not.toContain('secret-password');
      }
    }
  });
});
