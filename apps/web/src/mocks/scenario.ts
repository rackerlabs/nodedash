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

import { DEFAULT_SCENARIO_ID, findScenario, SCENARIOS, type Scenario } from '@nodedash/mock';

const STORAGE_KEY = 'nodedash.mock.scenario';

/**
 * The active scenario is read from `?scenario=` first so a walkthrough can be
 * shared as a URL, then from localStorage so it survives reloads.
 */
export function readScenarioId(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('scenario');
  if (fromUrl && SCENARIOS.some((scenario) => scenario.id === fromUrl)) {
    window.localStorage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SCENARIO_ID;
}

export function activeScenario(): Scenario {
  return findScenario(readScenarioId());
}

/** Switching scenario rebuilds all fixtures, so reload rather than patch state. */
export function setScenario(id: string): void {
  window.localStorage.setItem(STORAGE_KEY, id);
  const url = new URL(window.location.href);
  url.searchParams.delete('scenario');
  window.location.replace(url.toString());
}

export { SCENARIOS };
