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
  buildCapabilityReport,
  canRunServiceSteps,
  resolveInstanceName,
  runbookMatchesNode,
  supportsSupportAssist,
  toNodeRow,
  type ApiErrorCode,
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
  type SupportAssistCollection,
  type SupportAssistStartRequest,
  type VendorPassthruMethods,
} from '@nodedash/shared';
import {
  buildFixtures,
  supportAssistFilename,
  vendorPassthruMethodsFor,
  type Fixtures,
} from './fixtures.ts';
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

interface SupportAssistJob {
  collectionId: string;
  startedAt: number;
  completeAt: number;
  willFail: boolean;
  failure: string | null;
}

/** Fractions of the run spent queued and spent uploading, either end of collecting. */
const SUPPORT_ASSIST_PHASES = { queued: 0.05, uploading: 0.88 };

/**
 * Sign-in state the mock keeps across reloads. A real deployment holds this in its
 * encrypted session cookie, so persisting it here keeps reload behaviour
 * faithful instead of bouncing the reviewer back to the login screen.
 */
export interface PersistedAuth {
  authenticated: boolean;
  idp: string | null;
  region?: string | null;
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
  setRegion(region: string): Session;
  getScopeOptions(query: { search?: string; domainId?: string; limit?: number }): ScopeOptions;
  setScope(projectId: string): Session;
  clearScope(): Session;
  listNodes(query: { limit?: number; marker?: string }): { nodes: IronicNode[]; next: string | null };
  getNode(uuid: string): IronicNode;
  locateNode(uuid: string): LocateResult;
  setMaintenance(uuid: string, reason: string): IronicNode;
  clearMaintenance(uuid: string): IronicNode;
  setPower(uuid: string, target: PowerTarget): void;
  getInventory(uuid: string): unknown;
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
  listSupportAssist(uuid: string): { collections: SupportAssistCollection[]; supported: boolean };
  startSupportAssist(uuid: string, request: SupportAssistStartRequest): SupportAssistCollection;
  downloadSupportAssist(uuid: string, id: string): { filename: string; body: string };
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
  const supportAssistJobs = new Map<string, SupportAssistJob>();

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
    region: null,
    scope: null,
    lastScope: null,
    expiresAt: null,
    identityProviders,
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
      region: session.region ?? null,
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
      region: scenario.regions.some((region) => region.id === restored.region) ? restored.region : null,
      scope: project ? scopeFor(project) : null,
      lastScope: lastProject ? scopeFor(lastProject) : null,
    };
  }

  function requireAuth(): void {
    if (!session.authenticated) {
      throw new MockApiError(401, 'unauthenticated', 'Sign in to continue.');
    }
  }

  function requireRegion(): void {
    requireAuth();
    if (!session.region) {
      throw new MockApiError(409, 'no_region', 'Select a region first.');
    }
  }

  function requireScope(): Scope {
    requireRegion();
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
    for (const [uuid, job] of supportAssistJobs) {
      const collection = (fixtures.supportAssist.get(uuid) ?? []).find(
        (candidate) => candidate.id === job.collectionId,
      );
      if (!collection) {
        supportAssistJobs.delete(uuid);
        continue;
      }

      const fraction = Math.min(1, (timestamp - job.startedAt) / (job.completeAt - job.startedAt));
      if (fraction < 1) {
        collection.percent = Math.round(fraction * 100);
        collection.state =
          fraction < SUPPORT_ASSIST_PHASES.queued
            ? 'queued'
            : fraction < SUPPORT_ASSIST_PHASES.uploading
              ? 'collecting'
              : 'uploading';
        continue;
      }

      supportAssistJobs.delete(uuid);
      collection.finished_at = new Date(timestamp).toISOString();
      if (job.willFail) {
        collection.state = 'failed';
        collection.percent = null;
        collection.error = job.failure;
      } else {
        collection.state = 'available';
        collection.percent = 100;
        collection.size_bytes = (24 + Math.floor(Math.random() * 160)) * 1024 * 1024;
        collection.expires_at = new Date(timestamp + 14 * 86_400_000).toISOString();
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
      session = { ...session, authenticated: false, user: null, region: null, scope: null, expiresAt: null };
      persist();
    },

    getCapabilities() {
      // The real BFF asks the selected region's Ironic, so it needs a scope too.
      requireScope();
      return capabilities;
    },

    getRegions() {
      requireAuth();
      return { regions: scenario.regions };
    },

    setRegion(region: string) {
      requireAuth();
      if (!scenario.regions.some((candidate) => candidate.id === region)) {
        throw new MockApiError(400, 'bad_request', `Keystone has no region named ${region}.`);
      }
      session = { ...session, region, scope: null };
      persist();
      return session;
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
      requireRegion();
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
      const visible = fixtures.nodes.filter((node) => isVisibleTo(node, scope.projectId));
      const start = marker ? visible.findIndex((node) => node.uuid === marker) + 1 : 0;
      const page = visible.slice(start, start + limit);
      const next = start + limit < visible.length ? (page[page.length - 1]?.uuid ?? null) : null;
      return { nodes: page, next };
    },

    getNode: (uuid: string) => nodeInScope(uuid),

    locateNode(uuid: string) {
      requireAuth();
      const node = nodesByUuid.get(uuid);
      if (!node || !node.owner) return { found: false, scope: null, projectsSearched: fixtures.projects.length };
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
      return inventory;
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
      if (!runbookMatchesNode(runbook, node.traits ?? [], { runbookTraits: capabilities.capabilities.runbookTraits })) {
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

      const filtered = query.severity
        ? all.filter((entry) => entry.severity === query.severity)
        : all;
      const start = query.marker
        ? filtered.findIndex((entry) => entry.id === query.marker) + 1
        : 0;
      const limit = query.limit ?? 50;
      const page = filtered.slice(start, start + limit);
      return {
        entries: page,
        next: start + limit < filtered.length ? (page[page.length - 1]?.id ?? null) : null,
      };
    },

    listSupportAssist(uuid: string) {
      const node = nodeInScope(uuid);
      const supported = supportsSupportAssist(vendorPassthruMethodsFor(node.driver));
      if (!supported) return { collections: [], supported: false };
      return { collections: fixtures.supportAssist.get(node.uuid) ?? [], supported: true };
    },

    startSupportAssist(uuid: string, request: SupportAssistStartRequest) {
      const node = nodeInScope(uuid);
      if (!supportsSupportAssist(vendorPassthruMethodsFor(node.driver))) {
        throw new MockApiError(
          406,
          'unsupported',
          `Driver ${node.driver ?? 'unknown'} does not offer SupportAssist. Only Dell nodes on the idrac hardware type can collect one.`,
        );
      }
      if (!request.data_selectors || request.data_selectors.length === 0) {
        throw new MockApiError(400, 'bad_request', 'Select at least one category of data to collect.');
      }
      if (supportAssistJobs.has(node.uuid)) {
        throw new MockApiError(
          409,
          'conflict',
          'A SupportAssist collection is already running on this node. The BMC will only run one at a time.',
        );
      }

      const startedAt = now();
      // Asking the BMC for OS-side data needs a running host to talk to, so this
      // is the failure DC operators will actually hit.
      const needsRunningHost = request.data_selectors.includes('OSAppData');
      const willFail = needsRunningHost && node.power_state !== 'power on';

      const collection: SupportAssistCollection = {
        id: `${node.uuid.slice(0, 8)}-${startedAt.toString(36)}`,
        state: 'queued',
        percent: 0,
        started_at: new Date(startedAt).toISOString(),
        finished_at: null,
        estimated_completion_at: new Date(startedAt + scenario.supportAssistMs).toISOString(),
        requested_by: session.user?.name ?? 'unknown',
        data_selectors: [...request.data_selectors],
        filter_pii: request.filter_pii,
        filename: supportAssistFilename(node, new Date(startedAt).toISOString()),
        size_bytes: null,
        expires_at: null,
        error: null,
      };

      const existing = fixtures.supportAssist.get(node.uuid) ?? [];
      // Newest first, which is the order the UI renders.
      fixtures.supportAssist.set(node.uuid, [collection, ...existing]);
      supportAssistJobs.set(node.uuid, {
        collectionId: collection.id,
        startedAt,
        completeAt: startedAt + scenario.supportAssistMs,
        willFail,
        failure: willFail
          ? 'OS Collector could not reach the host agent: the node is not powered on, so OS and application data could not be gathered.'
          : null,
      });

      return collection;
    },

    downloadSupportAssist(uuid: string, id: string) {
      const node = nodeInScope(uuid);
      const collection = (fixtures.supportAssist.get(node.uuid) ?? []).find(
        (candidate) => candidate.id === id,
      );
      if (!collection) {
        throw new MockApiError(404, 'not_found', `No SupportAssist collection ${id} for this node.`);
      }
      if (collection.state === 'expired') {
        throw new MockApiError(
          410,
          'not_found',
          'This bundle has passed its retention window and been deleted from storage.',
        );
      }
      if (collection.state !== 'available') {
        throw new MockApiError(
          409,
          'conflict',
          `This collection is ${collection.state}; only a finished collection can be downloaded.`,
        );
      }

      // The real bundle is a multi-hundred-megabyte archive straight from the BMC.
      // The mock hands back a readable placeholder so the download path is
      // reviewable without inventing a fake tarball.
      const body = [
        'MOCK SupportAssist bundle -- not real hardware data.',
        '',
        `node.name            ${node.name ?? '(unnamed)'}`,
        `node.uuid            ${node.uuid}`,
        `node.driver          ${node.driver ?? 'unknown'}`,
        `collection.id        ${collection.id}`,
        `started_at           ${collection.started_at}`,
        `finished_at          ${collection.finished_at ?? '(unfinished)'}`,
        `data_selectors       ${collection.data_selectors.join(', ')}`,
        `filter_pii           ${collection.filter_pii}`,
        `reported_size_bytes  ${collection.size_bytes ?? 0}`,
        `expires_at           ${collection.expires_at ?? '(no retention set)'}`,
        '',
        'A real collection arrives as the .tar.gz the BMC produced, streamed from',
        'object storage. Ironic reports the filename above.',
      ].join('\n');

      return { filename: `MOCK-${collection.filename ?? 'supportassist'}.txt`, body };
    },
  };
}
