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
import { redactSecrets } from './redact.ts';

describe('redactSecrets', () => {
  it('removes credential-bearing driver_info fields', () => {
    const node = {
      uuid: 'n-1',
      driver_info: {
        redfish_address: 'https://bmc.example.invalid',
        redfish_username: 'operator',
        redfish_password: 'hunter2',
        ipmi_password: 'hunter2',
      },
    };
    const result = redactSecrets(node);
    expect(result.driver_info.redfish_password).toBe('**redacted**');
    expect(result.driver_info.ipmi_password).toBe('**redacted**');
    // Non-secret fields are still useful for troubleshooting.
    expect(result.driver_info.redfish_address).toBe('https://bmc.example.invalid');
    expect(result.driver_info.redfish_username).toBe('operator');
  });

  it('reaches into nested structures and arrays', () => {
    const result = redactSecrets({
      nodes: [{ driver_internal_info: { agent_secret_token: 'abc', clean_steps: ['erase'] } }],
    });
    expect(result.nodes[0]!.driver_internal_info.agent_secret_token).toBe('**redacted**');
    expect(result.nodes[0]!.driver_internal_info.clean_steps).toEqual(['erase']);
  });

  it('matches secret-ish keys regardless of case or prefix', () => {
    const result = redactSecrets({
      BMC_Password: 'x',
      snmp_priv_passphrase: 'x',
      private_key: 'x',
      vnc_password: 'x',
      credential: 'x',
      description: 'not a secret',
    });
    expect(Object.entries(result).filter(([, value]) => value === '**redacted**')).toHaveLength(5);
    expect(result.description).toBe('not a secret');
  });

  it('leaves primitives and null alone', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets('plain')).toBe('plain');
    expect(redactSecrets(42)).toBe(42);
  });

  it('does not blow up on a self-referencing object', () => {
    const cyclic: Record<string, unknown> = { name: 'node' };
    cyclic.self = cyclic;
    expect(() => redactSecrets(cyclic)).not.toThrow();
  });
});
