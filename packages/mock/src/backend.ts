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

import {
  buildExtraPatch,
  DEFAULT_BRANDING,
  buildCapabilityReport,
  canRunServiceSteps,
  resolveInstanceName,
  runbookMatchesNode,
  supportsSupportAssist,
  toNodeRow,
  type ApiErrorCode,
  type SupportAssistArchive,
  type CapabilitiesResponse,
  type IronicNode,
  type LocateResult,
  type NodeConsole,
  type PowerTarget,
  type Project,
  type LogEntry,
  type LogService,
  type NodeHealth,
  type NodeHistoryEvent,
  type NodeLogArchiveList,
  type NodeLogContent,
  type Scope,
  type ScopeOptions,
  type RegionList,
  type Session,
  type SupportAssistJob,
  type VendorPassthruMethods,
} from '@nodedash/shared';
import { buildFixtures, withPortLldp, vendorPassthruMethodsFor, type Fixtures } from './fixtures.ts';
import type { Scenario } from './scenarios.ts';

export class MockApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MockApiError';
  }
}

/** How long the fake BMC takes to do things, in ms. */
const TIMINGS = {
  power: 4_000,
  consoleEnable: 2_500,
  service: 12_000,
};

interface PendingPower {
  target: PowerTarget;
  completeAt: number;
}

interface ConsoleState {
  enabled: boolean;
  enablingUntil: number | null;
  url: string | null;
}

interface ServiceRun {
  runbookName: string;
  startedAt: number;
  completeAt: number;
  willFail: boolean;
}

interface PendingSupportAssistJob {
  taskMonitor: string;
  startedAt: number;
  completeAt: number;
}

/**
 * Sign-in state the mock keeps across reloads. A real deployment holds this in its
 * encrypted session cookie, so persisting it here keeps reload behaviour
 * faithful instead of bouncing the reviewer back to the login screen.
 */
export interface PersistedAuth {
  authenticated: boolean;
  idp: string | null;
  projectId: string | null;
  lastProjectId: string | null;
}

export interface MockBackendOptions {
  scenario: Scenario;
  /** Base path the fake graphical console URL points at. */
  consoleBasePath?: string;
  now?: () => number;
  persistence?: {
    load: () => PersistedAuth | null;
    save: (auth: PersistedAuth) => void;
  };
}

export interface MockBackend {
  readonly scenario: Scenario;
  readonly fixtures: Fixtures;
  getSession(): Session;
  login(idp: string): Session;
  logout(): void;
  getCapabilities(): CapabilitiesResponse;
  getRegions(): RegionList;
  /** Refuses a region the fixtures have no Ironic in, the way the real BFF does. */
  assertRegion(region: string): void;
  getScopeOptions(query: { search?: string; domainId?: string; limit?: number }): ScopeOptions;
  setScope(projectId: string): Session;
  clearScope(): Session;
  listNodes(query: { limit?: number; marker?: string }): { nodes: IronicNode[]; next: string | null };
  getNode(uuid: string): IronicNode;
  locateNode(uuid: string): LocateResult;
  setExtra(uuid: string, values: unknown): IronicNode;
  setMaintenance(uuid: string, reason: string): IronicNode;
  clearMaintenance(uuid: string): IronicNode;
  setPower(uuid: string, target: PowerTarget): void;
  getInventory(uuid: string): unknown;
  getPorts(uuid: string): unknown;
  getBios(uuid: string): unknown;
  getFirmware(uuid: string): unknown;
  listRunbooks(): unknown;
  runRunbook(uuid: string, runbookRef: string): void;
  getConsole(uuid: string): NodeConsole;
  setConsole(uuid: string, enabled: boolean): void;
  vendorPassthruMethods(uuid: string): VendorPassthruMethods;
  getHistory(uuid: string, query: { limit?: number }): { history: NodeHistoryEvent[]; next: string | null };
  listNodeLogs(uuid: string): NodeLogArchiveList;
  getNodeLog(uuid: string, id: string): NodeLogContent;
  getHealth(uuid: string): NodeHealth;
  listLogServices(uuid: string): { log_services: LogService[]; supported: boolean };
  getLogEntries(
    uuid: string,
    serviceId: string,
    query: { limit?: number; marker?: string; severity?: string },
  ): { entries: LogEntry[]; next: string | null };
  supportAssistArchives(uuid: string): SupportAssistArchive[];
  supportAssistEula(uuid: string): { accepted: boolean };
  startSupportAssist(uuid: string): { task_monitor: string };
  supportAssistJob(uuid: string, taskMonitor: string): SupportAssistJob;
  shouldFailRead(): boolean;
  assertMutationAllowed(): void;
  latencyMs(): number;
}

export function createMockBackend(options: MockBackendOptions): MockBackend {
  const { scenario } = options;
  const now = options.now ?? (() => Date.now());
  const consoleBasePath = options.consoleBasePath ?? '/mock-console';

  const fixtures = buildFixtures({
    seed: scenario.seed,
    projectCount: scenario.projectCount,
    nodeCount: scenario.nodeCount,
  });

  const nodesByUuid = new Map(fixtures.nodes.map((node) => [node.uuid, node]));
  const projectsById = new Map(fixtures.projects.map((project) => [project.id, project]));
  const domainsById = new Map(fixtures.domains.map((domain) => [domain.id, domain]));

  const pendingPower = new Map<string, PendingPower>();
  const consoles = new Map<string, ConsoleState>();
  const serviceRuns = new Map<string, ServiceRun>();
  /** At most one collection at a time per node, which is also the BMC's limit. */
  const supportAssistJobs = new Map<string, PendingSupportAssistJob>();

  const mockUser = {
    id: '9f2c1d8e4b7a4c6f8d1e2a3b4c5d6e7f',
    name: 'example-user@example.com',
    displayName: 'Example User',
    domainId: 'federated',
    domainName: 'Federated',
    idp: 'corp-sso',
  };

  const identityProviders = [{ id: 'corp-sso', protocol: 'saml2', label: 'Corp SSO' }];

  let session: Session = {
    authenticated: !scenario.startSignedOut,
    user: scenario.startSignedOut ? null : mockUser,
    scope: null,
    lastScope: null,
    expiresAt: null,
    identityProviders,
    branding: DEFAULT_BRANDING,
    editableExtraFields: ['external_cmdb_id', 'rack', 'position'],
  };

  function scopeFor(project: Project): Scope {
    const domain = domainsById.get(project.domain_id);
    return {
      domainId: project.domain_id,
      domainName: domain?.name ?? project.domain_id,
      projectId: project.id,
      projectName: project.name,
    };
  }

  function persist(): void {
    options.persistence?.save({
      authenticated: session.authenticated,
      idp: session.user?.idp ?? null,
      projectId: session.scope?.projectId ?? null,
      lastProjectId: session.lastScope?.projectId ?? null,
    });
  }

  const restored = options.persistence?.load();
  if (restored?.authenticated) {
    const project = restored.projectId ? projectsById.get(restored.projectId) : undefined;
    const lastProject = restored.lastProjectId ? projectsById.get(restored.lastProjectId) : undefined;
    session = {
      ...session,
      authenticated: true,
      user: { ...mockUser, idp: restored.idp ?? mockUser.idp },
      scope: project ? scopeFor(project) : null,
      lastScope: lastProject ? scopeFor(lastProject) : null,
    };
  }

  function requireAuth(): void {
    if (!session.authenticated) {
      throw new MockApiError(401, 'unauthenticated', 'Sign in to continue.');
    }
  }

  function requireScope(): Scope {
    requireAuth();
    if (!session.scope) {
      throw new MockApiError(409, 'no_scope', 'Select a domain and project first.');
    }
    return session.scope;
  }

  /**
   * Long-running BMC operations are modelled with deadlines rather than timers
   * and settled whenever state is read, so polling drives progress and nothing
   * keeps running after the tab is closed.
   */
  function settle(): void {
    const timestamp = now();
    for (const [uuid, pending] of pendingPower) {
      if (pending.completeAt > timestamp) continue;
      const node = nodesByUuid.get(uuid);
      pendingPower.delete(uuid);
      if (!node) continue;
      node.power_state =
        pending.target === 'power on' || pending.target.includes('reboot') ? 'power on' : 'power off';
      node.target_power_state = null;
      node.updated_at = new Date(timestamp).toISOString();
    }
    for (const [uuid, state] of consoles) {
      if (state.enablingUntil !== null && state.enablingUntil <= timestamp) {
        state.enabled = true;
        state.enablingUntil = null;
        const node = nodesByUuid.get(uuid);
        if (node) node.console_enabled = true;
      }
    }
    for (const [uuid, run] of serviceRuns) {
      if (run.completeAt > timestamp) continue;
      const node = nodesByUuid.get(uuid);
      serviceRuns.delete(uuid);
      if (!node) continue;
      if (run.willFail) {
        node.provision_state = 'service failed';
        node.last_error = `Service step failed while running runbook ${run.runbookName}: agent command timed out`;
      } else {
        node.provision_state = 'active';
        node.last_error = null;
      }
      node.target_provision_state = null;
      node.updated_at = new Date(timestamp).toISOString();
    }
  }

  /**
   * Ironic shows a node to the project that owns it and to the project leasing it.
   * Here that means the two `infra` projects see the hardware they own, and a
   * tenant project under `sddc` or `rxdb` sees only what has been leased to it.
   */
  function isVisibleTo(node: IronicNode, projectId: string): boolean {
    return node.owner === projectId || node.lessee === projectId;
  }

  function nodeInScope(uuid: string): IronicNode {
    const scope = requireScope();
    settle();
    const node = nodesByUuid.get(uuid);
    // A node outside the current project is indistinguishable from a missing one,
    // which is exactly how Ironic behaves with a project-scoped token.
    if (!node || !isVisibleTo(node, scope.projectId)) {
      throw new MockApiError(404, 'not_found', `Node ${uuid} was not found in this project.`);
    }
    return node;
  }

  function diagnosticsFor(node: IronicNode) {
    const diagnostics = fixtures.diagnostics(node.uuid);
    if (!diagnostics) {
      throw new MockApiError(404, 'not_found', `No diagnostic data for node ${node.uuid}.`);
    }
    return diagnostics;
  }

  /**
   * Plain IPMI cannot report structured health or expose Redfish log services. That
   * is a real gap in the hardware's capability rather than an error, so both callers
   * answer "unsupported" rather than throwing.
   */
  function reportsRedfishDiagnostics(node: IronicNode): boolean {
    return node.driver !== 'ipmi' || scenario.healthOnIpmi;
  }

  function consoleState(uuid: string): ConsoleState {
    let state = consoles.get(uuid);
    if (!state) {
      state = { enabled: false, enablingUntil: null, url: null };
      consoles.set(uuid, state);
    }
    return state;
  }

  const capabilities = buildCapabilityReport(scenario.serverMaxVersion);

  return {
    scenario,
    fixtures,
    latencyMs: () => scenario.latencyMs,
    shouldFailRead: () => Math.random() < scenario.readFailureRate,
    assertMutationAllowed() {
      if (scenario.rejectMutations) {
        throw new MockApiError(503, 'upstream_error', 'Ironic API is unavailable (simulated failure).');
      }
    },

    getSession() {
      settle();
      return session;
    },

    login(idp: string) {
      if (scenario.rejectSignIn) {
        throw new MockApiError(401, 'unauthenticated', 'Keystone rejected the token.');
      }
      session = {
        ...session,
        authenticated: true,
        user: { ...mockUser, idp },
        expiresAt: new Date(now() + 8 * 3600_000).toISOString(),
      };
      persist();
      return session;
    },

    logout() {
      session = { ...session, authenticated: false, user: null, scope: null, expiresAt: null };
      persist();
    },

    getCapabilities() {
      // The real BFF asks the region's Ironic, so it needs a scope too.
      requireScope();
      return capabilities;
    },

    getRegions() {
      requireAuth();
      return { regions: scenario.regions };
    },

    assertRegion(region: string) {
      requireAuth();
      if (!scenario.regions.some((candidate) => candidate.id === region)) {
        throw new MockApiError(
          404,
          'not_found',
          `Project has no bare metal (Ironic) endpoint in region ${region}.`,
        );
      }
    },

    getScopeOptions({ search, domainId, limit = 500 }) {
      requireAuth();
      const needle = search?.trim().toLowerCase();
      let projects = fixtures.projects;
      if (domainId) projects = projects.filter((project) => project.domain_id === domainId);
      if (needle) {
        projects = projects.filter(
          (project) =>
            project.name.toLowerCase().includes(needle) ||
            project.id.includes(needle) ||
            (project.description ?? '').toLowerCase().includes(needle),
        );
      }
      const truncated = projects.length > limit;
      return {
        domains: fixtures.domains,
        projects: truncated ? projects.slice(0, limit) : projects,
        truncated,
      };
    },

    setScope(projectId: string) {
      requireAuth();
      const project = projectsById.get(projectId);
      if (!project) {
        throw new MockApiError(404, 'not_found', `Project ${projectId} is not available to you.`);
      }
      const scope = scopeFor(project);
      session = { ...session, scope, lastScope: scope };
      persist();
      return session;
    },

    clearScope() {
      requireAuth();
      session = { ...session, scope: null };
      persist();
      return session;
    },

    listNodes({ limit = 500, marker }) {
      const scope = requireScope();
      settle();
      // Ironic hides child nodes unless asked; the BFF asks wherever the region can answer.
      const showChildren = capabilities.capabilities.childNodes;
      const visible = fixtures.nodes.filter(
        (node) => isVisibleTo(node, scope.projectId) && (showChildren || !node.parent_node),
      );
      const start = marker ? visible.findIndex((node) => node.uuid === marker) + 1 : 0;
      const page = visible.slice(start, start + limit);
      const next = start + limit < visible.length ? (page[page.length - 1]?.uuid ?? null) : null;
      return { nodes: page, next };
    },

    getNode: (uuid: string) => nodeInScope(uuid),

    locateNode(uuid: string) {
      requireAuth();
      const node = nodesByUuid.get(uuid);
      if (!node || !node.owner)
        return { found: false, scope: null, projectsSearched: fixtures.projects.length };
      // Resolves to the owning project. A lessee could also see the node, and the
      // real fan-out lands on whichever scope answers first, but the owner is the
      // project an operator wants for hardware work.
      const project = projectsById.get(node.owner);
      if (!project) return { found: false, scope: null, projectsSearched: fixtures.projects.length };
      const scope = scopeFor(project);
      session = { ...session, scope, lastScope: scope };
      persist();
      return {
        found: true,
        scope,
        // Report how far into the fan-out the node turned up, so the UI can be
        // honest about why a cold deep link took a moment.
        projectsSearched: fixtures.projects.findIndex((candidate) => candidate.id === project.id) + 1,
      };
    },

    setExtra(uuid: string, values: unknown) {
      const node = nodeInScope(uuid);
      // The BFF enforces the allowlist before Ironic is called, so refuse here too.
      const built = buildExtraPatch(session.editableExtraFields, values);
      if ('error' in built) throw new MockApiError(400, 'bad_request', built.error);
      // Ironic's `add` on an object member creates or replaces it.
      node.extra = { ...(node.extra ?? {}) };
      for (const op of built.patch) node.extra[op.path.slice('/extra/'.length)] = op.value;
      node.updated_at = new Date(now()).toISOString();
      return node;
    },

    setMaintenance(uuid: string, reason: string) {
      const node = nodeInScope(uuid);
      if (!reason.trim()) {
        throw new MockApiError(400, 'bad_request', 'A maintenance reason is required.');
      }
      node.maintenance = true;
      node.maintenance_reason = reason;
      node.updated_at = new Date(now()).toISOString();
      return node;
    },

    clearMaintenance(uuid: string) {
      const node = nodeInScope(uuid);
      node.maintenance = false;
      node.maintenance_reason = null;
      node.updated_at = new Date(now()).toISOString();
      return node;
    },

    setPower(uuid: string, target: PowerTarget) {
      const node = nodeInScope(uuid);
      if (pendingPower.has(uuid)) {
        throw new MockApiError(409, 'conflict', 'A power action is already in progress for this node.');
      }
      node.target_power_state =
        target === 'power on' ? 'power on' : target.includes('reboot') ? 'rebooting' : 'power off';
      pendingPower.set(uuid, { target, completeAt: now() + TIMINGS.power });
    },

    getInventory(uuid: string) {
      const node = nodeInScope(uuid);
      const inventory = fixtures.inventory.get(node.uuid);
      if (!inventory) {
        throw new MockApiError(
          404,
          'not_found',
          'No introspection data stored for this node. Run inspection to collect inventory.',
        );
      }
      const withLldp = withPortLldp(inventory, fixtures.ports(node.uuid));
      return {
        ...withLldp,
        inventory: { ...withLldp.inventory, pci_devices: fixtures.pciDevices(node.uuid) },
      };
    },

    getPorts(uuid: string) {
      const node = nodeInScope(uuid);
      return { ports: fixtures.ports(node.uuid) };
    },

    getBios(uuid: string) {
      const node = nodeInScope(uuid);
      return { bios: fixtures.bios.get(node.uuid) ?? [] };
    },

    getFirmware(uuid: string) {
      const node = nodeInScope(uuid);
      const firmware = fixtures.firmware.get(node.uuid);
      if (!firmware) {
        throw new MockApiError(404, 'not_found', 'No firmware information is cached for this node.');
      }
      return { firmware };
    },

    listRunbooks() {
      requireScope();
      return { runbooks: fixtures.runbooks };
    },

    runRunbook(uuid: string, runbookRef: string) {
      const node = nodeInScope(uuid);
      const runbook = fixtures.runbooks.find(
        (candidate) => candidate.uuid === runbookRef || candidate.name === runbookRef,
      );
      if (!runbook) {
        throw new MockApiError(404, 'not_found', `Runbook ${runbookRef} does not exist.`);
      }
      const eligibility = canRunServiceSteps(toNodeRow(node));
      if (!eligibility.allowed) {
        throw new MockApiError(409, 'conflict', eligibility.reason ?? 'Node cannot be serviced.');
      }
      if (
        !runbookMatchesNode(runbook, node.traits ?? [], {
          runbookTraits: capabilities.capabilities.runbookTraits,
        })
      ) {
        throw new MockApiError(
          400,
          'bad_request',
          `Node does not carry any trait required by runbook ${runbook.name}.`,
        );
      }
      node.provision_state = 'servicing';
      node.target_provision_state = 'active';
      node.last_error = null;
      serviceRuns.set(uuid, {
        runbookName: runbook.name,
        startedAt: now(),
        completeAt: now() + TIMINGS.service,
        // One runbook always fails, so the failure path is reviewable.
        willFail: runbook.name === 'nvme-secure-erase',
      });
    },

    getConsole(uuid: string) {
      const node = nodeInScope(uuid);
      const state = consoleState(node.uuid);
      return {
        console_enabled: state.enabled,
        console_info: state.enabled && state.url ? { type: 'vnc', url: state.url } : null,
      };
    },

    setConsole(uuid: string, enabled: boolean) {
      const node = nodeInScope(uuid);
      if (!capabilities.capabilities.graphicalConsole) {
        throw new MockApiError(
          406,
          'unsupported',
          'This Ironic API is too old to expose a graphical console.',
        );
      }
      const state = consoleState(node.uuid);
      if (!enabled) {
        state.enabled = false;
        state.enablingUntil = null;
        state.url = null;
        node.console_enabled = false;
        return;
      }
      if (state.enabled || state.enablingUntil !== null) return;
      const token = `${node.uuid.replace(/-/g, '')}${Math.floor(now() / 1000).toString(16)}`;
      state.enablingUntil = now() + TIMINGS.consoleEnable;
      state.url = `${consoleBasePath}?node=${node.uuid}&token=${token}&name=${encodeURIComponent(
        node.name ?? resolveInstanceName(node) ?? node.uuid,
      )}`;
    },

    vendorPassthruMethods(uuid: string) {
      const node = nodeInScope(uuid);
      return vendorPassthruMethodsFor(node.driver);
    },

    getHistory(uuid: string, query: { limit?: number }) {
      const node = nodeInScope(uuid);
      const history = diagnosticsFor(node).history;
      const limit = query.limit ?? 100;
      return {
        history: history.slice(0, limit),
        next: history.length > limit ? (history[limit]?.uuid ?? null) : null,
      };
    },

    listNodeLogs(uuid: string) {
      const node = nodeInScope(uuid);
      return { logs: diagnosticsFor(node).logs, supported: true };
    },

    getNodeLog(uuid: string, id: string) {
      const node = nodeInScope(uuid);
      const content = diagnosticsFor(node).logContent.get(id);
      if (content === undefined) {
        throw new MockApiError(404, 'not_found', `No log archive ${id} for this node.`);
      }
      // A real archive is capped server-side; the fixture is small enough that
      // nothing is actually cut, but the field is present so the UI path exists.
      return { id, content, truncated: false, line_count: content.split('\n').length };
    },

    getHealth(uuid: string) {
      const node = nodeInScope(uuid);
      if (!reportsRedfishDiagnostics(node)) {
        return {
          status: 'unknown',
          collected_at: null,
          source: 'ipmi',
          checks: [],
          sensors: [],
          supported: false,
        };
      }
      return diagnosticsFor(node).health;
    },

    listLogServices(uuid: string) {
      const node = nodeInScope(uuid);
      if (!reportsRedfishDiagnostics(node)) {
        return { log_services: [], supported: false };
      }
      return { log_services: diagnosticsFor(node).logServices, supported: true };
    },

    getLogEntries(uuid: string, serviceId: string, query) {
      const node = nodeInScope(uuid);
      const all = diagnosticsFor(node).logEntries.get(serviceId);
      if (!all) {
        throw new MockApiError(404, 'not_found', `This node has no log service ${serviceId}.`);
      }

      const filtered = query.severity ? all.filter((entry) => entry.severity === query.severity) : all;
      const start = query.marker ? filtered.findIndex((entry) => entry.id === query.marker) + 1 : 0;
      const limit = query.limit ?? 50;
      const page = filtered.slice(start, start + limit);
      return {
        entries: page,
        next: start + limit < filtered.length ? (page[page.length - 1]?.id ?? null) : null,
      };
    },

    supportAssistArchives(uuid: string) {
      const node = nodeInScope(uuid);
      if (!supportsSupportAssist(vendorPassthruMethodsFor(node.driver))) {
        throw new MockApiError(406, 'unsupported', 'Driver does not offer SupportAssist.');
      }
      const job = supportAssistJobs.get(uuid);
      if (!job || job.completeAt > now()) return [];
      const modified = new Date(job.completeAt).toISOString();
      const serial = fixtures.inventory.get(uuid)?.inventory.system_vendor?.serial_number;
      if (!serial) throw new MockApiError(406, 'unsupported', 'No inventory serial number.');
      return [
        { name: `TSR${modified.replace(/[^0-9]/g, '').slice(0, 14)}_${serial}.zip`, modified, size: 22 },
      ];
    },

    supportAssistEula(uuid: string) {
      const node = nodeInScope(uuid);
      if (!supportsSupportAssist(vendorPassthruMethodsFor(node.driver))) {
        throw new MockApiError(406, 'unsupported', 'Driver does not offer SupportAssist.');
      }
      return { accepted: fixtures.supportAssistEula.get(uuid) ?? true };
    },

    startSupportAssist(uuid: string) {
      const node = nodeInScope(uuid);
      if (!supportsSupportAssist(vendorPassthruMethodsFor(node.driver))) {
        throw new MockApiError(406, 'unsupported', 'Driver does not offer SupportAssist.');
      }
      if (fixtures.supportAssistEula.get(uuid) === false) {
        throw new MockApiError(400, 'bad_request', 'SupportAssist EULA has not been accepted.');
      }
      const existing = supportAssistJobs.get(uuid);
      if (existing && existing.completeAt > now()) {
        throw new MockApiError(409, 'conflict', 'A SupportAssist collection is already running.');
      }
      const startedAt = now();
      const taskMonitor = `/redfish/v1/Managers/iDRAC.Embedded.1/Oem/Dell/Jobs/JID_${startedAt}`;
      supportAssistJobs.set(uuid, {
        taskMonitor,
        startedAt,
        completeAt: startedAt + scenario.supportAssistMs,
      });
      return { task_monitor: taskMonitor };
    },

    supportAssistJob(uuid: string, taskMonitor: string) {
      nodeInScope(uuid);
      const job = supportAssistJobs.get(uuid);
      if (!job || job.taskMonitor !== taskMonitor) {
        throw new MockApiError(404, 'not_found', 'Job not found.');
      }
      const fraction = Math.min(1, (now() - job.startedAt) / (job.completeAt - job.startedAt));
      const state = fraction < 1 ? 'Running' : 'Completed';
      return {
        task_monitor: taskMonitor,
        is_processing: fraction < 1,
        task_state: state,
        task_status: 'OK',
        job_state: state,
        percent_complete: Math.round(fraction * 100),
        messages: [
          { Message: fraction < 1 ? 'Collecting SupportAssist data.' : 'Collection completed successfully.' },
        ],
      };
    },
  };
}
