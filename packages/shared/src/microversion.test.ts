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
import {
  atLeast,
  buildCapabilityReport,
  CLIENT_MAX_MICROVERSION,
  negotiateMicroversion,
  parseMicroversion,
} from './microversion.ts';

describe('parseMicroversion', () => {
  it('parses a well formed version', () => {
    expect(parseMicroversion('1.92')).toEqual({ major: 1, minor: 92 });
  });

  it('rejects anything that is not major.minor', () => {
    for (const value of ['', 'latest', '1', '1.2.3', 'v1.92', null, undefined]) {
      expect(parseMicroversion(value)).toBeNull();
    }
  });
});

describe('negotiateMicroversion', () => {
  it('uses the server version when the server is older than this client', () => {
    expect(negotiateMicroversion('1.85')).toBe('1.85');
  });

  it('caps at what this client understands when the server is newer', () => {
    expect(negotiateMicroversion('1.250')).toBe(CLIENT_MAX_MICROVERSION);
  });

  it('compares minor versions numerically, not as strings', () => {
    // '1.9' > '1.114' as strings, which would silently pick the wrong version.
    expect(negotiateMicroversion('1.9')).toBe('1.9');
    expect(negotiateMicroversion('1.114')).toBe('1.114');
  });

  it('falls back to the baseline when the server reports nothing usable', () => {
    expect(negotiateMicroversion(null)).toBe('1.1');
    expect(negotiateMicroversion('nonsense')).toBe('1.1');
  });
});

describe('atLeast', () => {
  it('handles the major version boundary', () => {
    expect(atLeast({ major: 2, minor: 0 }, '1.114')).toBe(true);
    expect(atLeast({ major: 1, minor: 114 }, '2.0')).toBe(false);
  });
});

describe('buildCapabilityReport', () => {
  it('enables everything on a current server', () => {
    const report = buildCapabilityReport('1.114');
    expect(report.negotiatedVersion).toBe('1.114');
    expect(report.capabilities).toMatchObject({
      inventory: true,
      firmware: true,
      serviceSteps: true,
      runbooks: true,
      runbookTraits: true,
      graphicalConsole: true,
    });
  });

  it('hides features an older server cannot serve', () => {
    const report = buildCapabilityReport('1.85');
    expect(report.capabilities).toMatchObject({
      inventory: true,
      firmware: false,
      serviceSteps: false,
      runbooks: false,
      runbookTraits: false,
      graphicalConsole: false,
    });
  });

  it('treats a server that reports no version as supporting nothing optional', () => {
    const report = buildCapabilityReport(undefined);
    expect(Object.values(report.capabilities).every((value) => value === false)).toBe(true);
    expect(report.serverMaxVersion).toBeNull();
  });

  it('turns on runbook traits only from 1.112', () => {
    expect(buildCapabilityReport('1.111').capabilities.runbookTraits).toBe(false);
    expect(buildCapabilityReport('1.112').capabilities.runbookTraits).toBe(true);
  });
});
