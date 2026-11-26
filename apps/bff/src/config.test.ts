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

describe('SupportAssist archive storage', () => {
  const archiveEnv = {
    ...baseEnv,
    SUPPORT_ASSIST_ARCHIVE_URL: 'https://cdn.{region}.example.invalid/supportassist-archives/',
    SUPPORT_ASSIST_ARCHIVE_USERNAME: 'reader',
    SUPPORT_ASSIST_ARCHIVE_PASSWORD: 'secret-password',
  };
  it('is off unless a URL is set', () => {
    expect(loadConfig({ ...baseEnv } as NodeJS.ProcessEnv).supportAssistArchive).toBeNull();
  });
  it('keeps the {region} template and the shared credential', () => {
    expect(loadConfig(archiveEnv as NodeJS.ProcessEnv).supportAssistArchive).toEqual({
      url: 'https://cdn.{region}.example.invalid/supportassist-archives/',
      username: 'reader',
      password: 'secret-password',
    });
  });
  it('refuses unsafe settings without printing credentials', () => {
    for (const override of [
      { SUPPORT_ASSIST_ARCHIVE_URL: 'http://cdn.{region}.example.invalid/' },
      { SUPPORT_ASSIST_ARCHIVE_URL: 'https://cdn.example.invalid/' },
      { SUPPORT_ASSIST_ARCHIVE_URL: 'https://reader:secret-password@cdn.{region}.example.invalid/' },
      { SUPPORT_ASSIST_ARCHIVE_URL: 'https://cdn.{region}.example.invalid/?a=b' },
      { SUPPORT_ASSIST_ARCHIVE_USERNAME: 'read:er' },
      { SUPPORT_ASSIST_ARCHIVE_USERNAME: '' },
      { SUPPORT_ASSIST_ARCHIVE_PASSWORD: '' },
    ]) {
      const env = { ...archiveEnv, ...override } as NodeJS.ProcessEnv;
      expect(() => loadConfig(env)).toThrow(/SUPPORT_ASSIST_ARCHIVE_/);
      try {
        loadConfig(env);
      } catch (error) {
        expect(String(error)).not.toContain('secret-password');
      }
    }
  });
});
