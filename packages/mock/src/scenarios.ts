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

import type { Region } from '@nodedash/shared';

/**
 * Scenarios let a reviewer flip the whole app between the situations that are
 * hard to reach on a real deployment: a huge fleet, an empty one, an old API,
 * or a backend that is failing.
 */
export interface Scenario {
  id: string;
  label: string;
  description: string;
  seed: number;
  projectCount: number;
  nodeCount: number;
  /** Value the fake Ironic reports as x-openstack-ironic-api-maximum-version. */
  serverMaxVersion: string;
  /** Artificial latency in ms applied to every request. */
  latencyMs: number;
  /** Probability that a read request fails with a 500. */
  readFailureRate: number;
  /** Force every mutating request to be rejected, to exercise error surfaces. */
  rejectMutations: boolean;
  /** Start signed out rather than pre-authenticated. */
  startSignedOut: boolean;
  /**
   * Keystone regions offered after sign-in. With one, the UI selects it without
   * asking. The fixtures are the same in every region; only the choice is modelled.
   */
  regions: Region[];
  /**
   * How long a SupportAssist collection takes. A real one is around half an hour,
   * which is unwatchable in a walkthrough, so the default compresses it. Set it to
   * 1_800_000 to review the real pacing.
   */
  supportAssistMs: number;
  /**
   * Whether plain-IPMI nodes report structured health. They cannot in reality, so
   * this stays off; it exists to make the unsupported path easy to reach or skip.
   */
  healthOnIpmi: boolean;
}

const base: Omit<Scenario, 'id' | 'label' | 'description'> = {
  seed: 20260819,
  projectCount: 60,
  nodeCount: 240,
  serverMaxVersion: '1.114',
  latencyMs: 120,
  readFailureRate: 0,
  rejectMutations: false,
  startSignedOut: true,
  regions: [{ id: 'lab-1', description: 'Lab region' }],
  supportAssistMs: 45_000,
  healthOnIpmi: false,
};

export const SCENARIOS: Scenario[] = [
  {
    ...base,
    id: 'default',
    label: 'Default fleet',
    description: '240 nodes across 60 projects on a current Ironic (1.114).',
  },
  {
    ...base,
    id: 'large',
    label: 'Large fleet',
    description: '5,000 nodes and 4,000 projects — exercises virtualization and the project search.',
    projectCount: 4000,
    nodeCount: 5000,
  },
  {
    ...base,
    id: 'empty',
    label: 'Empty project',
    description: 'Authenticated with projects but no nodes, to check empty states.',
    nodeCount: 0,
  },
  {
    ...base,
    id: 'legacy',
    label: 'Legacy Ironic (1.85)',
    description: 'Old API: firmware, runbooks and graphical console are unavailable and hidden.',
    serverMaxVersion: '1.85',
  },
  {
    ...base,
    id: 'errors',
    label: 'Failing backend',
    description: 'Reads fail intermittently and every mutation is rejected.',
    readFailureRate: 0.35,
    rejectMutations: true,
  },
  {
    ...base,
    id: 'support-assist-realtime',
    label: 'SupportAssist at real pace',
    description: 'Collections take the full 30 minutes, to review the long-running UI honestly.',
    supportAssistMs: 30 * 60_000,
  },
  {
    ...base,
    id: 'multi-region',
    label: 'Several regions',
    description: 'Three Keystone regions, so the region picker is shown after sign-in.',
    regions: [
      { id: 'lab-1', description: 'Lab region' },
      { id: 'lab-2', description: 'Second lab region' },
      { id: 'lab-3', description: null },
    ],
  },
  {
    ...base,
    id: 'slow',
    label: 'Slow backend',
    description: '2.5s latency on every call, to review loading and skeleton states.',
    latencyMs: 2500,
  },
];

export const DEFAULT_SCENARIO_ID = 'default';

export function findScenario(id: string | null | undefined): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0]!;
}
