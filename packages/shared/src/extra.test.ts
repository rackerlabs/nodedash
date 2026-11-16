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
import { buildExtraPatch, MAX_EXTRA_VALUE_LENGTH } from './extra.ts';

const allowed = ['rack', 'position'];

describe('buildExtraPatch', () => {
  it('adds each allowed key, which also creates one the node never had', () => {
    expect(buildExtraPatch(allowed, { rack: ' A12 ', position: '7' })).toEqual({
      patch: [
        { op: 'add', path: '/extra/rack', value: 'A12' },
        { op: 'add', path: '/extra/position', value: '7' },
      ],
    });
  });

  it('refuses a field that is not configured, including ones that look like paths', () => {
    for (const field of ['owner', '__proto__', 'rack/../../driver', '']) {
      expect(buildExtraPatch(allowed, { [field]: 'x' })).toMatchObject({
        error: expect.stringContaining('not an editable'),
      });
    }
  });

  it('refuses everything when one field is out of bounds, rather than applying part', () => {
    expect(buildExtraPatch(allowed, { rack: 'A1', owner: 'x' })).toHaveProperty('error');
  });

  it('refuses empty, non-string, oversized and control-character values', () => {
    expect(buildExtraPatch(allowed, { rack: '  ' })).toHaveProperty('error');
    expect(buildExtraPatch(allowed, { rack: 12 })).toHaveProperty('error');
    expect(buildExtraPatch(allowed, { rack: 'x'.repeat(MAX_EXTRA_VALUE_LENGTH + 1) })).toHaveProperty(
      'error',
    );
    expect(buildExtraPatch(allowed, { rack: 'a\nb' })).toHaveProperty('error');
  });

  it('refuses a body that is not an object, or names nothing', () => {
    for (const bad of [null, undefined, 'rack', ['rack'], {}]) {
      expect(buildExtraPatch(allowed, bad)).toHaveProperty('error');
    }
  });

  it('allows nothing when no fields are configured', () => {
    expect(buildExtraPatch([], { rack: 'A1' })).toHaveProperty('error');
  });
});
