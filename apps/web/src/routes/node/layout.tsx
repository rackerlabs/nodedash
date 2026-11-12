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

import { CAPABILITY_MICROVERSIONS, toNodeRow, nodeDisplayName } from '@nodedash/shared';
import { ArrowLeft, Radar, RefreshCw, Search, TriangleAlert, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { CopyValue } from '@/components/copy-value';
import { MaintenanceBadge, PowerStateBadge, ProvisionStateBadge } from '@/components/node-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { Hint } from '@/components/ui/tooltip';
import { useCapabilities } from '@/features/auth/session';
import { ConsoleButton } from '@/features/node/console-button';
import { ClearMaintenanceDialog, MaintenanceDialog } from '@/features/node/maintenance-dialog';
import { PowerMenu } from '@/features/node/power-menu';
import { useResolvedNode } from '@/features/node/use-node';
import {
  activeCollection,
  useSupportAssist,
  useSupportAssistSupported,
} from '@/features/node/use-support-assist';
import { ScopePickerDialog } from '@/features/scope/scope-picker';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ErrorPanel, FullPageSpinner } from '../status';
import type { NodeContext } from './context';

interface TabDefinition {
  to: string;
  label: string;
  /** Hidden with an explanation when the negotiated microversion is too old. */
  capability?: keyof typeof CAPABILITY_MICROVERSIONS;
  /**
   * Hidden outright when this node's driver cannot do it. Unlike a microversion
   * gap this is not a deployment shortcoming, so there is nothing useful to say
   * in a tooltip; the route itself still explains why if someone links to it.
   */
  driverGated?: boolean;
  end?: boolean;
}

const TABS: TabDefinition[] = [
  { to: '', label: 'Overview', end: true },
  { to: 'health', label: 'Health' },
  { to: 'inventory', label: 'Inventory', capability: 'inventory' },
  { to: 'bios', label: 'BIOS' },
  { to: 'firmware', label: 'Firmware', capability: 'firmware' },
  { to: 'logs', label: 'Logs' },
  { to: 'runbooks', label: 'Runbooks', capability: 'runbooks' },
  { to: 'support-assist', label: 'SupportAssist', driverGated: true },
];

export function NodeLayout() {
  const { uuid = '' } = useParams();
  const { node, phase, isLocating, projectsSearched, retry } = useResolvedNode(uuid);
  const capabilities = useCapabilities();
  const { supported: supportAssistSupported } = useSupportAssistSupported(uuid, {
    enabled: phase === 'ready',
  });
  // Shares its query key with the tab itself, so this costs no extra request and
  // surfaces a running collection while the operator is on another tab.
  const supportAssist = useSupportAssist(uuid, { enabled: supportAssistSupported });
  const collecting = activeCollection(supportAssist.query.data?.collections) !== null;
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (phase === 'unresolvable') {
    return (
      <>
        <ErrorPanel title="Node not found in any of your projects">
          <p className="text-sm text-muted-foreground">
            Searched {formatCount(projectsSearched)} project{projectsSearched === 1 ? '' : 's'} for{' '}
            <span className="font-mono text-[12px]">{uuid}</span>. It may belong to a project you cannot
            access, or it may have been deleted.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <Search className="size-4" />
              Choose a project
            </Button>
            <Button variant="ghost" size="sm" onClick={retry}>
              Search again
            </Button>
          </div>
        </ErrorPanel>
        <ScopePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} />
      </>
    );
  }

  if (phase === 'error') {
    return <ErrorPanel title="Could not load this node" error={node.error} onRetry={retry} />;
  }

  if (phase !== 'ready' || !node.data) {
    return (
      <FullPageSpinner
        label={
          isLocating
            ? 'Looking for this node across your projects…'
            : 'Loading node…'
        }
      />
    );
  }

  const data = node.data;
  const row = toNodeRow(data);
  const context: NodeContext = { node: data, row, refresh: () => void node.refetch() };

  return (
    <div className="flex flex-col">
      <div className="border-b border-border bg-card/40">
        <div className="flex flex-col gap-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="sm" asChild className="-ml-2 gap-1.5 text-muted-foreground">
              <Link to="/nodes">
                <ArrowLeft className="size-4" />
                All nodes
              </Link>
            </Button>

            <h1 className="text-lg font-semibold tracking-tight">{nodeDisplayName(row)}</h1>
            <CopyValue value={data.uuid} label="Copy node UUID" className="text-muted-foreground" />

            <div className="flex flex-wrap items-center gap-2">
              <ProvisionStateBadge state={row.provisionState} target={row.targetProvisionState} />
              <PowerStateBadge state={row.powerState} target={row.targetPowerState} />
              {row.maintenance ? (
                <MaintenanceBadge maintenance reason={row.maintenanceReason} />
              ) : null}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Hint label="Reload this node from Ironic">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void node.refetch()}
                  aria-label="Refresh node"
                >
                  <RefreshCw className={cn(node.isFetching && 'animate-spin')} />
                </Button>
              </Hint>
              <ConsoleButton node={row} />
              {row.maintenance ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setMaintenanceOpen(true)}>
                    <Wrench className="size-4" />
                    Edit reason
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setClearOpen(true)}>
                    Clear maintenance
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setMaintenanceOpen(true)}>
                  <Wrench className="size-4" />
                  Set maintenance
                </Button>
              )}
              <PowerMenu node={row} />
            </div>
          </div>

          {row.maintenance ? (
            <Banner tone="destructive" icon={<Wrench className="size-4" />}>
              <span className="font-medium">In maintenance.</span>{' '}
              {row.maintenanceReason ?? 'No reason was recorded.'}
            </Banner>
          ) : null}

          {row.lastError ? (
            <Banner tone="destructive" icon={<TriangleAlert className="size-4" />}>
              <span className="font-medium">Last error:</span> {row.lastError}
            </Banner>
          ) : null}

          {row.targetProvisionState && row.provisionState !== row.targetProvisionState ? (
            <Banner tone="warning" icon={<Spinner className="size-4" />}>
              Ironic is moving this node from <span className="font-mono">{row.provisionState}</span> to{' '}
              <span className="font-mono">{row.targetProvisionState}</span>. This page is polling for
              updates.
            </Banner>
          ) : null}

          <nav className="flex flex-wrap items-center gap-1 border-b border-border">
            {TABS.map((tab) => {
              if (tab.driverGated && !supportAssistSupported) return null;

              const unsupported =
                tab.capability !== undefined &&
                capabilities.data !== undefined &&
                !capabilities.data.capabilities[tab.capability];

              if (unsupported) {
                return (
                  <Hint
                    key={tab.label}
                    label={`Requires Ironic API ${CAPABILITY_MICROVERSIONS[tab.capability!]}; this deployment negotiated ${capabilities.data?.negotiatedVersion}.`}
                  >
                    <span className="flex cursor-not-allowed items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground/50">
                      {tab.label}
                      <Radar className="size-3.5" />
                    </span>
                  </Hint>
                );
              }

              return (
                <NavLink
                  key={tab.label}
                  to={tab.to === '' ? `/nodes/${uuid}` : `/nodes/${uuid}/${tab.to}`}
                  end={tab.end}
                  className={({ isActive }) =>
                    cn(
                      'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {tab.label}
                  {tab.driverGated && collecting ? (
                    <Spinner className="ml-1.5 inline size-3 align-[-1px]" />
                  ) : null}
                </NavLink>
              );
            })}
            {capabilities.data ? (
              <Badge tone="outline" className="ml-auto mb-1.5 font-mono text-[10px]">
                API {capabilities.data.negotiatedVersion}
              </Badge>
            ) : null}
          </nav>
        </div>
      </div>

      <div className="px-4 py-4">
        <Outlet context={context} />
      </div>

      <MaintenanceDialog node={row} open={maintenanceOpen} onOpenChange={setMaintenanceOpen} />
      <ClearMaintenanceDialog node={row} open={clearOpen} onOpenChange={setClearOpen} />
    </div>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'destructive' | 'warning';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        tone === 'destructive'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-warning/40 bg-warning/10 text-warning',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
