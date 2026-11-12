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
import { formatBytes, relativeTime, timeUntil } from './format';

const now = Date.UTC(2026, 7, 19, 12, 0, 0);

describe('timeUntil', () => {
  it('counts forward to a deadline', () => {
    expect(timeUntil(now + 30_000, now)).toBe('in 30s');
    expect(timeUntil(now + 5 * 60_000, now)).toBe('in 5m');
    expect(timeUntil(now + 3 * 3600_000, now)).toBe('in 3h');
    expect(timeUntil(now + 5 * 86_400_000, now)).toBe('in 5d');
  });

  it('falls back to the past form once the deadline has gone by', () => {
    expect(timeUntil(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('reports a missing deadline as never, matching relativeTime', () => {
    expect(timeUntil(null, now)).toBe('never');
    expect(relativeTime(null, now)).toBe('never');
  });
});

describe('relativeTime', () => {
  it('does not run forward, which is why timeUntil exists', () => {
    // A retention date in the future would otherwise read as "just now".
    expect(relativeTime(now + 5 * 86_400_000, now)).toBe('just now');
  });
});

describe('formatBytes', () => {
  it('scales to a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(43 * 1024 * 1024)).toBe('43.0 MiB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GiB');
  });

  it('renders an unknown size as a dash rather than zero', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });
});
