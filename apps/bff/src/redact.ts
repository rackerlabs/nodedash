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

/**
 * Strips credential-bearing fields before anything is sent to the browser.
 *
 * Ironic masks most driver secrets already, but not consistently across drivers
 * and versions, and driver_internal_info is a free-form bag. Since this UI never
 * displays credentials, drop them on the way out rather than trusting upstream.
 */
const SECRET_KEY_PATTERN = /(password|secret|token|private_key|passphrase|credential)/i;

const REDACTED = '**redacted**';

export function redactSecrets<T>(value: T): T {
  return redactValue(value, 0) as T;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(entry, depth + 1);
  }
  return output;
}
