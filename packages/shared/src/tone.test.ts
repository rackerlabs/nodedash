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
  healthTone,
  historySeverityTone,
  logSeverityTone,
  provisionTone,
  supportAssistTone,
  toneLookup,
} from './index.ts';

describe('toneLookup', () => {
  const tone = toneLookup({ ok: 'active', bad: 'error' });

  it('maps a known value', () => {
    expect(tone('ok')).toBe('active');
    expect(tone('bad')).toBe('error');
  });

  it('ignores case, because these vocabularies arrive in every casing', () => {
    expect(tone('OK')).toBe('active');
    expect(tone('Bad')).toBe('error');
  });

  it('falls back for unknown, empty and missing values', () => {
    expect(tone('something-else')).toBe('neutral');
    expect(tone('')).toBe('neutral');
    expect(tone(null)).toBe('neutral');
    expect(tone(undefined)).toBe('neutral');
  });

  it('honours a custom fallback', () => {
    expect(toneLookup({ ok: 'active' }, 'error')('nope')).toBe('error');
  });
});

describe('vocabulary tones', () => {
  it('renders provision states', () => {
    expect(provisionTone('active')).toBe('active');
    expect(provisionTone('deploy failed')).toBe('error');
    expect(provisionTone('servicing')).toBe('transient');
    expect(provisionTone('who knows')).toBe('neutral');
  });

  it('renders health, collection and severity vocabularies', () => {
    expect(healthTone('critical')).toBe('error');
    expect(healthTone('unknown')).toBe('neutral');
    expect(supportAssistTone('collecting')).toBe('transient');
    expect(supportAssistTone('available')).toBe('active');
    expect(supportAssistTone('expired')).toBe('neutral');
    expect(historySeverityTone('ERROR')).toBe('error');
    expect(logSeverityTone('Critical')).toBe('error');
  });

  it('matches Redfish and Ironic severities whichever case they arrive in', () => {
    // Ironic sends WARNING, Redfish sends Warning; both must render the same.
    expect(historySeverityTone('warning')).toBe(historySeverityTone('WARNING'));
    expect(logSeverityTone('critical')).toBe(logSeverityTone('Critical'));
  });
});
