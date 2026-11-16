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
 * What an operator may put in a node's `extra` field. `extra` is free-form in
 * Ironic, so the deployment names the keys the UI may write; anything else is
 * refused here, on the BFF and in the form alike.
 */

/** Keys that become a JSON Patch path segment, so no `/` or `~` to escape. */
export const EXTRA_FIELD_NAME = /^[A-Za-z0-9_.-]+$/;
export const MAX_EXTRA_VALUE_LENGTH = 255;

export interface JsonPatchOperation {
  op: 'add';
  path: string;
  value: string;
}

export type ExtraPatchResult = { patch: JsonPatchOperation[] } | { error: string };

/** Why a value cannot be stored, or null when it can. */
export function extraValueProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return 'a value is required';
  if (value.trim().length > MAX_EXTRA_VALUE_LENGTH) {
    return `must be at most ${MAX_EXTRA_VALUE_LENGTH} characters`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return 'must not contain control characters';
  return null;
}

/**
 * JSON Patch for setting the given extra keys. `add` is used for every key: on an
 * object member it creates the key when absent and replaces it when present, so
 * a node that never had the field is handled by the same call.
 */
export function buildExtraPatch(allowed: readonly string[], values: unknown): ExtraPatchResult {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    return { error: 'values must be an object of field names to values.' };
  }
  const entries = Object.entries(values);
  if (entries.length === 0) return { error: 'At least one field is required.' };

  const patch: JsonPatchOperation[] = [];
  for (const [field, value] of entries) {
    if (!allowed.includes(field)) {
      return {
        error: `"${field}" is not an editable field. Editable fields: ${allowed.join(', ') || 'none'}.`,
      };
    }
    const problem = extraValueProblem(value);
    if (problem) return { error: `${field}: ${problem}.` };
    patch.push({ op: 'add', path: `/extra/${field}`, value: (value as string).trim() });
  }
  return { patch };
}
