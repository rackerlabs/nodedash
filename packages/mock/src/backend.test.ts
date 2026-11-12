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
import { createMockBackend, MockApiError } from './backend.ts';
import { findScenario } from './scenarios.ts';

function setup(scenarioId = 'default') {
  const scenario = { ...findScenario(scenarioId), latencyMs: 0 };
  const backend = createMockBackend({ scenario });
  backend.login('corp-sso');
  backend.setRegion('lab-1');
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
    expect(() => backend.listNodes({})).toThrowError(/Select a region/);
    backend.setRegion('lab-1');
    expect(() => backend.listNodes({})).toThrowError(/Select a domain and project/);
  });

  it('drops the selected project when the region changes, keeping it as the last one', () => {
    const backend = createMockBackend({ scenario: { ...findScenario('multi-region'), latencyMs: 0 } });
    backend.login('corp-sso');
    expect(backend.getRegions().regions).toHaveLength(3);
    backend.setRegion('lab-1');
    const project = backend.fixtures.projects[0]!;
    backend.setScope(project.id);

    const session = backend.setRegion('lab-2');
    expect(session).toMatchObject({ region: 'lab-2', scope: null });
    expect(session.lastScope?.projectId).toBe(project.id);
    expect(() => backend.setRegion('nowhere')).toThrowError(/no region named nowhere/);
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
    backend.setRegion('lab-1');
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
    backend.setRegion('lab-1');
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
    backend.setRegion('lab-1');
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
      expect(backend.fixtures.inventory.get(node.uuid)!.inventory.system_vendor?.manufacturer).toBe(
        vendor,
      );
      const firmware = backend.fixtures.firmware.get(node.uuid);
      if (firmware) expect(firmware[0]!.vendor).toBe(vendor);
    }
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
  backend.setRegion('lab-1');
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
  it('offers the passthru only on the idrac driver', () => {
    const { backend, nodes } = setupWithClock();
    const dellIdrac = idracNode(nodes);
    const other = nodes.find((candidate) => candidate.driver !== 'idrac')!;

    expect(backend.listSupportAssist(dellIdrac.uuid).supported).toBe(true);
    expect(backend.listSupportAssist(other.uuid).supported).toBe(false);
    expect(backend.listSupportAssist(other.uuid).collections).toEqual([]);
  });

  it('refuses to start a collection on a node whose driver cannot do it', () => {
    const { backend, nodes } = setupWithClock();
    const other = nodes.find((candidate) => candidate.driver !== 'idrac')!;
    expect(() =>
      backend.startSupportAssist(other.uuid, { data_selectors: ['HWData'], filter_pii: true }),
    ).toThrowError(/does not offer SupportAssist/);
  });

  it('requires at least one category of data', () => {
    const { backend, nodes } = setupWithClock();
    expect(() =>
      backend.startSupportAssist(idracNode(nodes).uuid, { data_selectors: [], filter_pii: true }),
    ).toThrowError(/at least one category/);
  });

  it('runs one collection at a time, as the BMC does', () => {
    const { backend, nodes } = setupWithClock();
    const node = idracNode(nodes);
    backend.startSupportAssist(node.uuid, { data_selectors: ['HWData'], filter_pii: true });
    expect(() =>
      backend.startSupportAssist(node.uuid, { data_selectors: ['HWData'], filter_pii: true }),
    ).toThrowError(/already running/);
  });

  it('moves through queued, collecting and uploading before it is available', () => {
    const { backend, clock, scenario, nodes } = setupWithClock();
    const node = idracNode(nodes);
    const started = backend.startSupportAssist(node.uuid, {
      data_selectors: ['HWData', 'Debug'],
      filter_pii: true,
    });
    expect(started.state).toBe('queued');

    function stateNow(): string {
      return backend.listSupportAssist(node.uuid).collections.find((c) => c.id === started.id)!.state;
    }

    clock.now += scenario.supportAssistMs * 0.5;
    expect(stateNow()).toBe('collecting');

    clock.now += scenario.supportAssistMs * 0.45;
    expect(stateNow()).toBe('uploading');

    clock.now += scenario.supportAssistMs * 0.1;
    expect(stateNow()).toBe('available');

    const finished = backend
      .listSupportAssist(node.uuid)
      .collections.find((collection) => collection.id === started.id)!;
    expect(finished.percent).toBe(100);
    expect(finished.finished_at).toBeTruthy();
    expect(finished.size_bytes).toBeGreaterThan(0);
    // A bundle that can hold customer data gets a retention date, not permanence.
    expect(finished.expires_at).toBeTruthy();
  });

  it('fails when OS data is requested from a node that is not powered on', () => {
    const { backend, clock, scenario, nodes } = setupWithClock();
    const node = nodes.find(
      (candidate) => candidate.driver === 'idrac' && candidate.power_state !== 'power on',
    );
    if (!node) return; // fixture set happened to have none; nothing to assert

    const started = backend.startSupportAssist(node.uuid, {
      data_selectors: ['HWData', 'OSAppData'],
      filter_pii: false,
    });
    clock.now += scenario.supportAssistMs + 1;

    const finished = backend
      .listSupportAssist(node.uuid)
      .collections.find((collection) => collection.id === started.id)!;
    expect(finished.state).toBe('failed');
    expect(finished.error).toMatch(/not powered on/);
    expect(() => backend.downloadSupportAssist(node.uuid, started.id)).toThrowError(/only a finished/);
  });

  it('downloads a finished bundle and refuses one that has expired', () => {
    const { backend, nodes } = setupWithClock();
    const node = nodes.find((candidate) =>
      backend.fixtures.supportAssist
        .get(candidate.uuid)
        ?.some((collection) => collection.state === 'available'),
    );
    if (!node) return;

    const available = backend.fixtures.supportAssist
      .get(node.uuid)!
      .find((collection) => collection.state === 'available')!;
    const file = backend.downloadSupportAssist(node.uuid, available.id);
    expect(file.body).toContain(node.uuid);
    expect(file.filename).toMatch(/^MOCK-/);

    const expired = backend.fixtures.supportAssist
      .get(node.uuid)!
      .find((collection) => collection.state === 'expired');
    if (expired) {
      expect(() => backend.downloadSupportAssist(node.uuid, expired.id)).toThrowError(
        /retention window/,
      );
    }
  });

  it('keeps collections scoped to the project that owns the node', () => {
    const { backend, nodes } = setupWithClock();
    const foreign = backend.fixtures.nodes.find(
      (candidate) => !nodes.some((visible) => visible.uuid === candidate.uuid),
    )!;
    expect(() => backend.listSupportAssist(foreign.uuid)).toThrowError(/not found in this project/);
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
    expect(() => backend.getLogEntries(nodes[0]!.uuid, 'NoSuchLog', {})).toThrowError(
      /no log service/,
    );
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
    for (const node of backend.fixtures.nodes) {
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
    for (const node of backend.fixtures.nodes) {
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
    const tenant = backend.fixtures.projects.find(
      (project) => project.id === leasedNode.lessee,
    )!;

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
        project.name !== 'baremetal' &&
        project.name !== 'netdev' &&
        project.id !== leasedNode.lessee,
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
