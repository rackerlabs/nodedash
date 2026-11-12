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
 * Every status vocabulary in this app — provision states, health, sensor states,
 * collection states, log severities — ends up as one of these tones so the badges
 * read consistently. The tones are the UI's, but the mapping belongs next to the
 * domain that defines each vocabulary.
 */
export type Tone = 'active' | 'transient' | 'available' | 'error' | 'neutral';

/**
 * Builds a lookup for one vocabulary. Case-insensitive, because some of these
 * vocabularies arrive upper-case from Ironic (`ERROR`) and some title-case from
 * Redfish (`Critical`), and every hand-written version of this got that wrong at
 * least once.
 */
export function toneLookup<T extends string>(
  mapping: Record<string, Tone>,
  fallback: Tone = 'neutral',
): (value: T | string | null | undefined) => Tone {
  const normalised = new Map<string, Tone>(
    Object.entries(mapping).map(([key, tone]) => [key.toLowerCase(), tone]),
  );
  return (value) => {
    if (!value) return fallback;
    return normalised.get(String(value).toLowerCase()) ?? fallback;
  };
}
