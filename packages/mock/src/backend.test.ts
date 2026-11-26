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
import { isPciBridge, NodeInventorySchema, pciClassLabel } from '@nodedash/shared';
import { createMockBackend, MockApiError } from './backend.ts';
import { findScenario } from './scenarios.ts';

function setup(scenarioId = 'default') {
  const scenario = { ...findScenario(scenarioId), latencyMs: 0 };
  const backend = createMockBackend({ scenario });
  backend.login('corp-sso');
  const project = backend.fixtures.projects[0]!;
  backend.setScope(project.id);
  const nodes = backend.listNodes({}).nodes;
  return { backend, project, nodes };
}

describe('mock backend: authentication and scope', () => {
  it('refuses node reads until a project is selected', () => {
    const backend = createMockBackend({ scenario: { ...findScenario('default'), latencyMs: 0 } });
    expect(() => backend.listNodes({})).toThrowError(/Sign in/);
    backend.login('corp-sso');
    expect(() => backend.listNodes({})).toThrowError(/Select a domain and project/);
  });

  it('refuses sign-in when the scenario has Keystone reject the token', () => {
    const backend = createMockBackend({ scenario: { ...findScenario('sign-in-fails'), latencyMs: 0 } });
    expect(() => backend.login('corp-sso')).toThrowError(MockApiError);
    expect(backend.getSession().authenticated).toBe(false);
  });

  it('keeps the selected project across regions and refuses one with no Ironic', () => {
    const backend = createMockBackend({ scenario: { ...findScenario('multi-region'), latencyMs: 0 } });
    backend.login('corp-sso');
    expect(backend.getRegions().regions).toHaveLength(3);
    backend.setScope(backend.fixtures.projects[0]!.id);

    expect(() => backend.assertRegion('lab-2')).not.toThrow();
    expect(backend.getSession().scope?.projectId).toBe(backend.fixtures.projects[0]!.id);
    expect(() => backend.assertRegion('nowhere')).toThrowError(
      /no bare metal \(Ironic\) endpoint in region nowhere/,
    );
  });

  it('remembers the last scope after it is cleared, the way a session cookie would', () => {
    const { backend, project } = setup();
    const session = backend.clearScope();
    expect(session.scope).toBeNull();
    expect(session.lastScope?.projectId).toBe(project.id);
  });
});

describe('mock backend: node visibility', () => {
  it('hides nodes owned by another project, as a scoped token does', () => {
    const { backend, project } = setup();
    const foreign = backend.fixtures.nodes.find((node) => node.owner !== project.id)!;
    expect(() => backend.getNode(foreign.uuid)).toThrowError(/was not found in this project/);
  });

  it('pages the listing with a marker', () => {
    const { backend } = setup();
    const first = backend.listNodes({ limit: 10 });
    expect(first.nodes).toHaveLength(10);
    expect(first.next).toBe(first.nodes[9]!.uuid);

    const second = backend.listNodes({ limit: 10, marker: first.next! });
    expect(second.nodes[0]!.uuid).not.toBe(first.nodes[9]!.uuid);
  });
});

describe('mock backend: child nodes', () => {
  it('seeds children that point at a parent the same project can see', () => {
    const { backend } = setup();
    const children = backend.fixtures.nodes.filter((node) => node.parent_node);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      const parent = backend.fixtures.nodes.find((node) => node.uuid === child.parent_node)!;
      expect(parent.parent_node).toBeFalsy();
      expect(child.owner).toBe(parent.owner);
    }
  });

  it('lists children alongside their parents where the region supports them', () => {
    const { backend, project } = setup();
    const listed = backend.listNodes({ limit: 5000 }).nodes;
    const expected = backend.fixtures.nodes.filter((node) => node.owner === project.id && node.parent_node);
    expect(expected.length).toBeGreaterThan(0);
    const uuids = new Set(listed.map((node) => node.uuid));
    for (const child of expected) {
      expect(uuids.has(child.uuid)).toBe(true);
      expect(uuids.has(child.parent_node!)).toBe(true);
    }
  });

  it('hides children where the region predates microversion 1.83', () => {
    const scenario = { ...findScenario('legacy'), serverMaxVersion: '1.82', latencyMs: 0 };
    const backend = createMockBackend({ scenario });
    backend.login('corp-sso');
    backend.setScope(backend.fixtures.projects[0]!.id);

    const listed = backend.listNodes({ limit: 5000 }).nodes;
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.some((node) => node.parent_node)).toBe(false);
  });

  it('still reads a child directly', () => {
    const { backend, project } = setup();
    const child = backend.fixtures.nodes.find((node) => node.parent_node && node.owner === project.id)!;
    expect(backend.getNode(child.uuid).parent_node).toBe(child.parent_node);
  });
});

describe('mock backend: extra fields', () => {
  it('creates a field the node lacks and replaces one it has', () => {
    const { backend, nodes } = setup();
    const uuid = nodes[0]!.uuid;
    backend.setExtra(uuid, { rack: 'A1' });
    expect(backend.setExtra(uuid, { rack: 'B2', position: '4' }).extra).toMatchObject({
      rack: 'B2',
      position: '4',
    });
  });

  it('refuses a field outside the allowlist and leaves the node alone', () => {
    const { backend, nodes } = setup();
    const before = { ...backend.getNode(nodes[0]!.uuid).extra };
    expect(() => backend.setExtra(nodes[0]!.uuid, { rack: 'A1', driver: 'x' })).toThrowError(
      /not an editable field/,
    );
    expect(backend.getNode(nodes[0]!.uuid).extra).toEqual(before);
  });
});

describe('mock backend: maintenance', () => {
  it('requires a reason', () => {
    const { backend, nodes } = setup();
    expect(() => backend.setMaintenance(nodes[0]!.uuid, '   ')).toThrowError(/reason is required/);
  });

  it('sets and clears maintenance state', () => {
    const { backend, nodes } = setup();
    const uuid = nodes[0]!.uuid;
    const updated = backend.setMaintenance(uuid, 'Awaiting DIMM');
    expect(updated.maintenance).toBe(true);
    expect(updated.maintenance_reason).toBe('Awaiting DIMM');

    const cleared = backend.clearMaintenance(uuid);
    expect(cleared.maintenance).toBe(false);
    expect(cleared.maintenance_reason).toBeNull();
  });
});

describe('mock backend: power', () => {
  it('settles a power action once its deadline passes', () => {
    let now = 1_000_000;
    const backend = createMockBackend({
      scenario: { ...findScenario('default'), latencyMs: 0 },
      now: () => now,
    });
    backend.login('corp-sso');
    backend.setScope(backend.fixtures.projects[0]!.id);
    const uuid = backend.listNodes({}).nodes[0]!.uuid;

    backend.setPower(uuid, 'power off');
    expect(backend.getNode(uuid).target_power_state).toBe('power off');

    now += 10_000;
    expect(backend.getNode(uuid).power_state).toBe('power off');
    expect(backend.getNode(uuid).target_power_state).toBeNull();
  });

  it('rejects a second power action while one is in flight', () => {
    const { backend, nodes } = setup();
    backend.setPower(nodes[0]!.uuid, 'rebooting');
    expect(() => backend.setPower(nodes[0]!.uuid, 'power off')).toThrowError(/already in progress/);
  });
});

describe('mock backend: runbooks', () => {
  it('refuses a runbook whose traits the node does not carry', () => {
    const { backend, nodes } = setup();
    const node = nodes.find((candidate) => candidate.provision_state === 'active')!;
    const unmatched = backend.fixtures.runbooks.find(
      (runbook) => !(runbook.traits ?? []).some((trait) => (node.traits ?? []).includes(trait)),
    )!;
    expect(() => backend.runRunbook(node.uuid, unmatched.name)).toThrowError(/does not carry any trait/);
  });

  it('refuses to service a node that is not active', () => {
    const { backend, nodes } = setup();
    const inactive = nodes.find((candidate) => candidate.provision_state !== 'active')!;
    const runbook = backend.fixtures.runbooks[0]!;
    expect(() => backend.runRunbook(inactive.uuid, runbook.name)).toThrowError(/active/);
  });

  it('moves an eligible node through servicing and back to active', () => {
    let now = 2_000_000;
    const backend = createMockBackend({
      scenario: { ...findScenario('default'), latencyMs: 0 },
      now: () => now,
    });
    backend.login('corp-sso');
    backend.setScope(backend.fixtures.projects[0]!.id);

    const candidate = backend
      .listNodes({})
      .nodes.find(
        (node) =>
          node.provision_state === 'active' &&
          !node.maintenance &&
          backend.fixtures.runbooks.some((runbook) =>
            (runbook.traits ?? []).some((trait) => (node.traits ?? []).includes(trait)),
          ),
      )!;
    const runbook = backend.fixtures.runbooks.find(
      (entry) =>
        entry.name !== 'nvme-secure-erase' &&
        (entry.traits ?? []).some((trait) => (candidate.traits ?? []).includes(trait)),
    )!;

    backend.runRunbook(candidate.uuid, runbook.name);
    expect(backend.getNode(candidate.uuid).provision_state).toBe('servicing');

    now += 30_000;
    expect(backend.getNode(candidate.uuid).provision_state).toBe('active');
  });
});

describe('mock backend: console', () => {
  it('becomes ready after the start-up delay and hands back a URL', () => {
    let now = 3_000_000;
    const backend = createMockBackend({
      scenario: { ...findScenario('default'), latencyMs: 0 },
      now: () => now,
      consoleBasePath: '/mock-console',
    });
    backend.login('corp-sso');
    backend.setScope(backend.fixtures.projects[0]!.id);
    const uuid = backend.listNodes({}).nodes[0]!.uuid;

    backend.setConsole(uuid, true);
    expect(backend.getConsole(uuid).console_enabled).toBe(false);

    now += 5_000;
    const ready = backend.getConsole(uuid);
    expect(ready.console_enabled).toBe(true);
    expect(ready.console_info?.url).toContain('/mock-console?node=');

    backend.setConsole(uuid, false);
    expect(backend.getConsole(uuid).console_enabled).toBe(false);
  });

  it('reports the console as unsupported on a legacy API', () => {
    const { backend, nodes } = setup('legacy');
    expect(backend.getCapabilities().capabilities.graphicalConsole).toBe(false);
    try {
      backend.setConsole(nodes[0]!.uuid, true);
      throw new Error('expected setConsole to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MockApiError);
      expect((error as MockApiError).code).toBe('unsupported');
    }
  });
});

describe('mock backend: locate', () => {
  it('finds a node in another project and switches the scope to it', () => {
    const { backend, project } = setup();
    const foreign = backend.fixtures.nodes.find((node) => node.owner !== project.id)!;

    const result = backend.locateNode(foreign.uuid);
    expect(result.found).toBe(true);
    expect(result.scope?.projectId).toBe(foreign.owner);
    expect(backend.getSession().scope?.projectId).toBe(foreign.owner);
    // Now readable, because the scope moved to the owning project.
    expect(backend.getNode(foreign.uuid).uuid).toBe(foreign.uuid);
  });

  it('reports not found for a uuid that belongs to nobody', () => {
    const { backend } = setup();
    const result = backend.locateNode('ffffffff-ffff-4fff-afff-ffffffffffff');
    expect(result.found).toBe(false);
    expect(result.scope).toBeNull();
  });
});

describe('mock fixtures', () => {
  it('are deterministic across builds so screenshots and links stay stable', () => {
    const scenario = { ...findScenario('default'), latencyMs: 0 };
    const first = createMockBackend({ scenario });
    const second = createMockBackend({ scenario });
    expect(first.fixtures.nodes.map((node) => node.uuid)).toEqual(
      second.fixtures.nodes.map((node) => node.uuid),
    );
  });

  it('keep traits, inventory and firmware describing the same machine', () => {
    const expectedVendor: Record<string, string> = {
      CUSTOM_DELL_R650: 'Dell Inc.',
      CUSTOM_DELL_R750: 'Dell Inc.',
      CUSTOM_HPE_DL380_GEN10: 'HPE',
      CUSTOM_SUPERMICRO_SYS_620: 'Supermicro',
    };
    const { backend } = setup();

    const checked = backend.fixtures.nodes.filter((node) => backend.fixtures.inventory.has(node.uuid));
    expect(checked.length).toBeGreaterThan(0);

    for (const node of checked.slice(0, 50)) {
      const hardwareTrait = node.traits?.[0] ?? '';
      const vendor = expectedVendor[hardwareTrait];
      expect(vendor, `unexpected hardware trait ${hardwareTrait}`).toBeDefined();
      expect(backend.fixtures.inventory.get(node.uuid)!.inventory.system_vendor?.manufacturer).toBe(vendor);
      const firmware = backend.fixtures.firmware.get(node.uuid);
      if (firmware) expect(firmware[0]!.vendor).toBe(vendor);
    }
  });
});

describe('mock fixtures: inspection data', () => {
  it('stamps inspection_finished_at on inspected nodes only, as Ironic does', () => {
    const { backend } = setup();
    const { nodes, inventory } = backend.fixtures;
    expect(nodes.some((node) => !inventory.has(node.uuid))).toBe(true);
    for (const node of nodes) {
      if (inventory.has(node.uuid)) {
        expect(Number.isNaN(Date.parse(node.inspection_finished_at!))).toBe(false);
        // Ironic keeps the timestamp on the node; it is not part of the stored inventory.
        expect(inventory.get(node.uuid)!.plugin_data).not.toHaveProperty('inspection_finished_at');
      } else {
        expect(node.inspection_finished_at).toBeNull();
      }
    }
  });

  it('serves both the older and the current Redfish inventory shapes', () => {
    const { backend, nodes } = setup();
    const inspected = nodes.filter((node) => backend.fixtures.inventory.has(node.uuid));
    const served = inspected.map((node) => NodeInventorySchema.parse(backend.getInventory(node.uuid)));
    const current = served.filter((data) => data.inventory.cpu?.socket_count != null);
    const older = served.filter((data) => data.inventory.cpu?.socket_count == null);
    expect(current.length).toBeGreaterThan(0);
    expect(older.length).toBeGreaterThan(0);

    for (const data of current) {
      const cpu = data.inventory.cpu!;
      expect(cpu.thread_count).toBe(cpu.count);
      expect(cpu.core_count! * 2).toBe(cpu.thread_count);
      for (const device of data.inventory.pci_devices!) {
        expect(device.class).toMatch(/^[A-Z][A-Za-z]+$/);
        expect(device.vendor_id).toMatch(/^[0-9a-f]{4}$/);
        expect(device.device_id).toBe(device.product_id);
      }
    }
    for (const data of older) {
      expect(data.inventory.cpu).not.toHaveProperty('core_count');
      for (const device of data.inventory.pci_devices!) {
        expect(device.class).toMatch(/^DeviceClass\.[A-Z_]+$/);
        expect(device.vendor_id).toMatch(/^0x[0-9a-f]{4}$/);
        expect(device).not.toHaveProperty('device_id');
      }
    }

    // Whichever shape it arrives in, the same device reads the same way.
    const labels = (data: (typeof served)[number]) =>
      new Set(data.inventory.pci_devices!.map((device) => pciClassLabel(device.class)));
    expect(labels(current[0]!)).toContain('Network controller');
    expect(labels(older[0]!)).toContain('Network controller');
    expect(current[0]!.inventory.pci_devices!.some(isPciBridge)).toBe(true);
    expect(older[0]!.inventory.pci_devices!.some(isPciBridge)).toBe(true);
  });
});

/**
 * Backend with a clock the test drives, so a 45s collection needs no waiting.
 * Scopes to `baremetal` by default, which owns the Dell fleet.
 */
function setupWithClock(scenarioId = 'default', projectName = 'baremetal') {
  const scenario = { ...findScenario(scenarioId), latencyMs: 0 };
  const clock = { now: Date.UTC(2026, 7, 19, 12, 0, 0) };
  const backend = createMockBackend({ scenario, now: () => clock.now });
  backend.login('corp-sso');
  const project = backend.fixtures.projects.find((candidate) => candidate.name === projectName);
  if (!project) throw new Error(`fixture set has no project named ${projectName}`);
  backend.setScope(project.id);
  const nodes = backend.listNodes({ limit: 5000 }).nodes;
  return { backend, clock, scenario, nodes, project };
}

function idracNode(nodes: ReturnType<typeof setupWithClock>['nodes']) {
  const node = nodes.find((candidate) => candidate.driver === 'idrac');
  if (!node) throw new Error('fixture set has no idrac node in the first project');
  return node;
}

describe('mock backend: SupportAssist', () => {
  it('rejects unsupported drivers and unaccepted EULA without accepting it', () => {
    const { backend, nodes } = setupWithClock();
    const other = nodes.find((candidate) => candidate.driver !== 'idrac')!;
    expect(() => backend.startSupportAssist(other.uuid)).toThrowError(/does not offer SupportAssist/);
    const node = idracNode(nodes);
    backend.fixtures.supportAssistEula.set(node.uuid, false);
    expect(backend.supportAssistEula(node.uuid).accepted).toBe(false);
    expect(() => backend.startSupportAssist(node.uuid)).toThrowError(/EULA/);
    expect(backend.supportAssistEula(node.uuid).accepted).toBe(false);
  });

  it('returns a monitor and polls the job through completion, retaining the result', () => {
    const { backend, clock, scenario, nodes } = setupWithClock();
    const node = idracNode(nodes);
    const { task_monitor } = backend.startSupportAssist(node.uuid);
    expect(backend.supportAssistJob(node.uuid, task_monitor).is_processing).toBe(true);
    expect(() => backend.startSupportAssist(node.uuid)).toThrowError(/already running/);
    clock.now += scenario.supportAssistMs * 0.5;
    expect(backend.supportAssistJob(node.uuid, task_monitor).percent_complete).toBe(50);
    clock.now += scenario.supportAssistMs;
    expect(backend.supportAssistJob(node.uuid, task_monitor)).toMatchObject({
      is_processing: false,
      task_state: 'Completed',
      percent_complete: 100,
    });
    expect(backend.supportAssistJob(node.uuid, task_monitor).is_processing).toBe(false);
    expect(() => backend.supportAssistJob(node.uuid, '/unknown')).toThrowError(/Job not found/);
  });

  it('keeps EULA and jobs scoped to the project that owns the node', () => {
    const { backend, nodes } = setupWithClock();
    const foreign = backend.fixtures.nodes.find(
      (candidate) => !nodes.some((visible) => visible.uuid === candidate.uuid),
    )!;
    expect(() => backend.supportAssistEula(foreign.uuid)).toThrowError(/not found in this project/);
    expect(() => backend.supportAssistJob(foreign.uuid, '/unknown')).toThrowError(
      /not found in this project/,
    );
  });
});

describe('mock backend: diagnostics', () => {
  it('returns node history newest first, the way Ironic does', () => {
    const { backend, nodes } = setupWithClock();
    const { history } = backend.getHistory(nodes[0]!.uuid, {});
    expect(history.length).toBeGreaterThan(1);

    const times = history.map((event) => new Date(event.created_at).getTime());
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]!).toBeLessThanOrEqual(times[index - 1]!);
    }
  });

  it('leads the history with the error a failed node is reporting', () => {
    const { backend, nodes } = setupWithClock();
    const failed = nodes.find((node) => node.last_error);
    if (!failed) return;

    const { history } = backend.getHistory(failed.uuid, {});
    expect(history[0]!.severity).toBe('ERROR');
    expect(history[0]!.event).toBe(failed.last_error);
  });

  it('pages history and reports a marker when there is more', () => {
    const { backend, nodes } = setupWithClock();
    const uuid = nodes[0]!.uuid;
    const all = backend.getHistory(uuid, { limit: 1000 });
    const page = backend.getHistory(uuid, { limit: 2 });

    expect(page.history).toHaveLength(2);
    expect(page.next).toBe(all.history.length > 2 ? all.history[2]!.uuid : null);
  });

  it('serves ramdisk logs whose content matches the failure', () => {
    const { backend, nodes } = setupWithClock();
    const failed = nodes.find((node) => node.last_error);
    if (!failed) return;

    const { logs } = backend.listNodeLogs(failed.uuid);
    expect(logs.length).toBeGreaterThan(0);
    const content = backend.getNodeLog(failed.uuid, logs[0]!.id);
    expect(content.content).toMatch(/ironic_python_agent/);
    expect(content.line_count).toBeGreaterThan(1);
  });

  it('refuses an unknown log archive', () => {
    const { backend, nodes } = setupWithClock();
    expect(() => backend.getNodeLog(nodes[0]!.uuid, 'nope')).toThrowError(/No log archive/);
  });

  it('reports the same diagnostics on a second read rather than reshuffling', () => {
    const { backend, nodes } = setupWithClock();
    const uuid = nodes[0]!.uuid;
    expect(backend.getHistory(uuid, {})).toEqual(backend.getHistory(uuid, {}));
    expect(backend.getHealth(uuid)).toEqual(backend.getHealth(uuid));
  });

  it('marks fans and power as absent on a node that is powered off, not as faults', () => {
    const { backend, nodes } = setupWithClock();
    const off = nodes.find((node) => node.power_state !== 'power on' && node.driver !== 'ipmi');
    if (!off) return;

    const health = backend.getHealth(off.uuid);
    const fans = health.sensors.filter((sensor) => sensor.type === 'Fan');
    expect(fans.length).toBeGreaterThan(0);
    for (const fan of fans) expect(fan.state).toBe('absent');

    // Stopped fans on a powered-off box are absent, not failed, so cooling is
    // unknown rather than critical. The node may still warn for other reasons
    // (an unresolved event-log entry), which is why this is not asserting 'ok'.
    expect(health.checks.find((check) => check.id === 'cooling')?.status).toBe('unknown');
    expect(health.status).not.toBe('critical');
  });

  it('says plainly that a plain-IPMI node cannot report health', () => {
    // Plain IPMI hardware lives in netdev, not in the Dell fleet.
    const { backend, nodes } = setupWithClock('default', 'netdev');
    const ipmi = nodes.find((node) => node.driver === 'ipmi');
    expect(ipmi).toBeDefined();
    if (!ipmi) return;

    const health = backend.getHealth(ipmi.uuid);
    expect(health.supported).toBe(false);
    expect(health.status).toBe('unknown');
    expect(health.sensors).toEqual([]);
    expect(backend.listLogServices(ipmi.uuid).supported).toBe(false);
  });

  it('exposes the Lifecycle Controller log only on Dell hardware', () => {
    const { backend, nodes } = setupWithClock();
    const idrac = nodes.find((node) => node.driver === 'idrac');
    const other = nodes.find((node) => node.driver === 'redfish' || node.driver === 'ilo5');

    if (idrac) {
      const ids = backend.listLogServices(idrac.uuid).log_services.map((service) => service.id);
      expect(ids).toContain('Sel');
      expect(ids).toContain('Lclog');
    }
    if (other) {
      const ids = backend.listLogServices(other.uuid).log_services.map((service) => service.id);
      expect(ids).toContain('Sel');
      expect(ids).not.toContain('Lclog');
    }
  });

  it('filters log entries by severity and pages them', () => {
    const { backend, nodes } = setupWithClock();
    const idrac = nodes.find((node) => node.driver === 'idrac');
    if (!idrac) return;

    const critical = backend.getLogEntries(idrac.uuid, 'Lclog', { severity: 'Critical', limit: 500 });
    expect(critical.entries.length).toBeGreaterThan(0);
    for (const entry of critical.entries) expect(entry.severity).toBe('Critical');

    const firstPage = backend.getLogEntries(idrac.uuid, 'Lclog', { limit: 5 });
    expect(firstPage.entries).toHaveLength(5);
    expect(firstPage.next).toBeTruthy();

    const secondPage = backend.getLogEntries(idrac.uuid, 'Lclog', {
      limit: 5,
      marker: firstPage.next!,
    });
    expect(secondPage.entries.map((e) => e.id)).not.toEqual(firstPage.entries.map((e) => e.id));
  });

  it('refuses a log service the node does not have', () => {
    const { backend, nodes } = setupWithClock();
    expect(() => backend.getLogEntries(nodes[0]!.uuid, 'NoSuchLog', {})).toThrowError(/no log service/);
  });
});

describe('mock backend: domains, ownership and leases', () => {
  it('has exactly the three real domains', () => {
    const { backend } = setupWithClock();
    expect(backend.fixtures.domains.map((domain) => domain.name)).toEqual(['sddc', 'rxdb', 'infra']);
  });

  it('puts only baremetal and netdev under infra', () => {
    const { backend } = setupWithClock();
    const infra = backend.fixtures.domains.find((domain) => domain.name === 'infra')!;
    const names = backend.fixtures.projects
      .filter((project) => project.domain_id === infra.id)
      .map((project) => project.name)
      .sort();
    expect(names).toEqual(['baremetal', 'netdev']);
  });

  it('puts every other project under sddc or rxdb', () => {
    const { backend } = setupWithClock();
    const infra = backend.fixtures.domains.find((domain) => domain.name === 'infra')!;
    const tenantDomainIds = backend.fixtures.domains
      .filter((domain) => domain.name !== 'infra')
      .map((domain) => domain.id);

    const tenants = backend.fixtures.projects.filter((project) => project.domain_id !== infra.id);
    expect(tenants.length).toBeGreaterThan(1);
    for (const project of tenants) expect(tenantDomainIds).toContain(project.domain_id);
  });

  it('owns every Dell node in baremetal and everything else in netdev', () => {
    const { backend } = setupWithClock();
    const byId = new Map(backend.fixtures.projects.map((project) => [project.id, project]));

    let dell = 0;
    let other = 0;
    // Children are DPU-style add-ons, not hosts, so carry no hardware model trait.
    for (const node of backend.fixtures.nodes.filter((node) => !node.parent_node)) {
      const isDell = (node.traits ?? []).some((trait) => trait.startsWith('CUSTOM_DELL_'));
      const owner = byId.get(node.owner!)!.name;
      if (isDell) {
        dell += 1;
        expect(owner).toBe('baremetal');
      } else {
        other += 1;
        expect(owner).toBe('netdev');
      }
    }
    // Dell-dominant estate, so baremetal is the main fleet.
    expect(dell).toBeGreaterThan(other);
  });

  it('never gives a node another vendor’s model trait', () => {
    const { backend } = setupWithClock();
    for (const node of backend.fixtures.nodes.filter((node) => !node.parent_node)) {
      const models = (node.traits ?? []).filter(
        (trait) =>
          trait.startsWith('CUSTOM_DELL_') ||
          trait.startsWith('CUSTOM_HPE_') ||
          trait.startsWith('CUSTOM_SUPERMICRO_'),
      );
      // Exactly one model trait: an HPE box must not be offered Dell BIOS runbooks.
      expect(models).toHaveLength(1);
    }
  });

  it('never makes a tenant project the owner of a node', () => {
    const { backend } = setupWithClock();
    const infra = backend.fixtures.domains.find((domain) => domain.name === 'infra')!;
    const byId = new Map(backend.fixtures.projects.map((project) => [project.id, project]));

    for (const node of backend.fixtures.nodes) {
      expect(byId.get(node.owner!)!.domain_id).toBe(infra.id);
    }
  });

  it('leases nodes only to tenant projects, never to an infra project', () => {
    const { backend } = setupWithClock();
    const infra = backend.fixtures.domains.find((domain) => domain.name === 'infra')!;
    const byId = new Map(backend.fixtures.projects.map((project) => [project.id, project]));

    const leased = backend.fixtures.nodes.filter((node) => node.lessee);
    expect(leased.length).toBeGreaterThan(0);
    for (const node of leased) {
      expect(byId.get(node.lessee!)!.domain_id).not.toBe(infra.id);
    }
  });

  it('shows a tenant exactly the nodes leased to it, as Ironic does', () => {
    const { backend } = setupWithClock();
    const leasedNode = backend.fixtures.nodes.find((node) => node.lessee)!;
    const tenant = backend.fixtures.projects.find((project) => project.id === leasedNode.lessee)!;

    backend.setScope(tenant.id);
    const visible = backend.listNodes({ limit: 5000 }).nodes;

    expect(visible.map((node) => node.uuid)).toContain(leasedNode.uuid);
    for (const node of visible) expect(node.lessee).toBe(tenant.id);
    // And the node reads fine through the lessee scope, not just in the listing.
    expect(backend.getNode(leasedNode.uuid).uuid).toBe(leasedNode.uuid);
  });

  it('hides a node from a tenant that is not leasing it', () => {
    const { backend } = setupWithClock();
    const leasedNode = backend.fixtures.nodes.find((node) => node.lessee)!;
    const otherTenant = backend.fixtures.projects.find(
      (project) =>
        project.name !== 'baremetal' && project.name !== 'netdev' && project.id !== leasedNode.lessee,
    )!;

    backend.setScope(otherTenant.id);
    expect(() => backend.getNode(leasedNode.uuid)).toThrowError(/not found in this project/);
  });

  it('shows the owner every node it owns, leased or not', () => {
    const { backend, nodes, project } = setupWithClock();
    const owned = backend.fixtures.nodes.filter((node) => node.owner === project.id);
    expect(nodes).toHaveLength(owned.length);
    // Leasing a node out does not take it away from the project that owns it.
    expect(owned.some((node) => node.lessee)).toBe(true);
  });
});
