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
import type { IronicNode } from './ironic.ts';
import {
  canRunServiceSteps,
  isTransientProvisionState,
  provisionTone,
  requiresTypedConfirmation,
  resolveInstanceName,
  runbookMatchesNode,
  toNodeRow,
} from './nodes.ts';

function node(overrides: Partial<IronicNode> = {}): IronicNode {
  return { uuid: '00000000-0000-4000-a000-000000000000', ...overrides } as IronicNode;
}

describe('resolveInstanceName', () => {
  it('prefers the native field on recent servers', () => {
    expect(
      resolveInstanceName(
        node({ instance_name: 'web-01', instance_info: { display_name: 'stale-name' } }),
      ),
    ).toBe('web-01');
  });

  it('falls back to instance_info for older microversions', () => {
    expect(resolveInstanceName(node({ instance_info: { display_name: 'web-02' } }))).toBe('web-02');
    expect(resolveInstanceName(node({ instance_info: { hostname: 'web-03' } }))).toBe('web-03');
  });

  it('ignores empty strings rather than showing a blank name', () => {
    expect(resolveInstanceName(node({ instance_name: '', instance_info: { hostname: 'web-04' } }))).toBe(
      'web-04',
    );
  });

  it('returns null when the node is not deployed', () => {
    expect(resolveInstanceName(node({ instance_info: {} }))).toBeNull();
    expect(resolveInstanceName(node())).toBeNull();
  });
});

describe('toNodeRow', () => {
  it('normalises absent values so the table never renders undefined', () => {
    const row = toNodeRow(node({ provision_state: 'active' }));
    expect(row).toMatchObject({
      name: null,
      provisionState: 'active',
      instanceUuid: null,
      instanceName: null,
      maintenance: false,
      maintenanceReason: null,
    });
  });

  it('treats a missing maintenance flag as not in maintenance', () => {
    expect(toNodeRow(node({ maintenance: null })).maintenance).toBe(false);
    expect(toNodeRow(node({ maintenance: true })).maintenance).toBe(true);
  });
});

describe('provisionTone', () => {
  it('recognises the space separated states Ironic actually returns', () => {
    expect(provisionTone('deploy failed')).toBe('error');
    expect(provisionTone('clean wait')).toBe('transient');
    expect(provisionTone('wait call-back')).toBe('transient');
    expect(provisionTone('service failed')).toBe('error');
    expect(provisionTone('active')).toBe('active');
  });

  it('falls back to neutral for states it has never seen', () => {
    expect(provisionTone('some-future-state')).toBe('neutral');
    expect(provisionTone(null)).toBe('neutral');
  });
});

describe('isTransientProvisionState', () => {
  it('drives polling only while Ironic is mid-operation', () => {
    expect(isTransientProvisionState('servicing')).toBe(true);
    expect(isTransientProvisionState('active')).toBe(false);
  });
});

describe('requiresTypedConfirmation', () => {
  it('demands typing for hard actions on a node running an instance', () => {
    const deployed = { instanceUuid: 'i-1' };
    expect(requiresTypedConfirmation('power off', deployed)).toBe(true);
    expect(requiresTypedConfirmation('rebooting', deployed)).toBe(true);
  });

  it('does not for graceful actions, or for an undeployed node', () => {
    expect(requiresTypedConfirmation('soft power off', { instanceUuid: 'i-1' })).toBe(false);
    expect(requiresTypedConfirmation('soft rebooting', { instanceUuid: 'i-1' })).toBe(false);
    expect(requiresTypedConfirmation('power off', { instanceUuid: null })).toBe(false);
  });
});

describe('canRunServiceSteps', () => {
  it('allows service steps on an active node', () => {
    expect(canRunServiceSteps({ provisionState: 'active', maintenance: false }).allowed).toBe(true);
  });

  it('explains why a non-active node cannot be serviced', () => {
    const result = canRunServiceSteps({ provisionState: 'available', maintenance: false });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('available');
  });

  it('blocks while the node is in maintenance', () => {
    const result = canRunServiceSteps({ provisionState: 'active', maintenance: true });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('maintenance');
  });
});

describe('runbookMatchesNode', () => {
  const runbook = { name: 'CUSTOM_BIOS_BASELINE', traits: ['CUSTOM_DELL_R650', 'CUSTOM_DELL_R750'] };

  it('matches on the runbook traits from 1.112', () => {
    expect(runbookMatchesNode(runbook, ['CUSTOM_DELL_R750'], { runbookTraits: true })).toBe(true);
    expect(runbookMatchesNode(runbook, ['CUSTOM_HPE_DL380_GEN10'], { runbookTraits: true })).toBe(false);
  });

  it('falls back to the name-as-trait rule on older servers', () => {
    expect(runbookMatchesNode(runbook, ['CUSTOM_DELL_R750'], { runbookTraits: false })).toBe(false);
    expect(runbookMatchesNode(runbook, ['CUSTOM_BIOS_BASELINE'], { runbookTraits: false })).toBe(true);
  });

  it('uses the name rule when a 1.112 server reports no traits on the runbook', () => {
    const untraited = { name: 'CUSTOM_BIOS_BASELINE', traits: [] };
    expect(runbookMatchesNode(untraited, ['CUSTOM_BIOS_BASELINE'], { runbookTraits: true })).toBe(true);
  });

  it('never matches a node with no traits', () => {
    expect(runbookMatchesNode(runbook, [], { runbookTraits: true })).toBe(false);
  });
});
