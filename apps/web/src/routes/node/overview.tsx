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

import { CopyValue } from '@/components/copy-value';
import { PowerStateBadge, ProvisionStateBadge } from '@/components/node-badges';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/misc';
import { useSession } from '@/features/auth/session';
import { formatTimestamp } from '@/lib/format';
import { useNodeContext } from './context';

export function NodeOverviewPage() {
  const { node, row } = useNodeContext();
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const extra = node.extra ?? {};

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Identity and state</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <Field label="Name">
              {row.name ?? <span className="text-muted-foreground italic">unnamed</span>}
            </Field>
            <Field label="UUID">
              <CopyValue value={row.uuid} label="Copy node UUID" />
            </Field>
            <Field label="Provision state">
              <ProvisionStateBadge state={row.provisionState} target={row.targetProvisionState} />
            </Field>
            <Field label="Power state">
              <PowerStateBadge state={row.powerState} target={row.targetPowerState} />
            </Field>
            <Field label="Instance UUID">
              {row.instanceUuid ? (
                <CopyValue value={row.instanceUuid} label="Copy instance UUID" />
              ) : (
                <span className="text-muted-foreground">not deployed</span>
              )}
            </Field>
            <Field label="Instance name">
              {row.instanceName ?? <span className="text-muted-foreground">—</span>}
            </Field>
            <Field label="Maintenance">
              {row.maintenance ? (
                <Badge tone="error">enabled</Badge>
              ) : (
                <span className="text-muted-foreground">disabled</span>
              )}
            </Field>
            <Field label="Maintenance reason">
              {row.maintenanceReason ?? <span className="text-muted-foreground">—</span>}
            </Field>
            <Field label="Last error" className="sm:col-span-2">
              {row.lastError ? (
                <span className="whitespace-pre-wrap text-destructive">{row.lastError}</span>
              ) : (
                <span className="text-muted-foreground">none</span>
              )}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Management</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8">
            <Field label="Driver" mono>
              {node.driver ?? '—'}
            </Field>
            <Field label="Resource class" mono>
              {node.resource_class ?? '—'}
            </Field>
            <Field label="Conductor group" mono>
              {node.conductor_group || '—'}
            </Field>
            <Field label="Owner" mono>
              <ProjectRef projectId={node.owner} />
            </Field>
            <Field label="Lessee" mono>
              <ProjectRef projectId={node.lessee} />
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Traits</CardTitle>
        </CardHeader>
        <CardContent>
          {node.traits && node.traits.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {node.traits.map((trait) => (
                <Badge key={trait} tone="outline" className="font-mono text-[11px]">
                  {trait}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No traits set. Runbooks are matched to nodes by trait, so a node without traits cannot run
              any.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered properties</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            {Object.keys(properties).length === 0 ? (
              <p className="text-sm text-muted-foreground">No properties recorded.</p>
            ) : (
              <RecordFields record={properties} />
            )}
          </dl>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Extra</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(extra).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing in this node&apos;s extra field.</p>
          ) : (
            <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              <RecordFields record={extra} />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Timestamps</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 sm:grid-cols-3">
            <Field label="Created">{formatTimestamp(node.created_at)}</Field>
            <Field label="Updated">{formatTimestamp(node.updated_at)}</Field>
            <Field label="Description">{node.description ?? '—'}</Field>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

/** One field per key, in the order Ironic returned them; nested values as JSON. */
function RecordFields({ record }: { record: Record<string, unknown> }) {
  return Object.entries(record).map(([key, value]) => (
    <Field key={key} label={key} mono>
      {value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)}
    </Field>
  ));
}

/**
 * A project id, marked when it is the project currently in scope. Owner and lessee
 * both grant access in Ironic but not the same rights, so which one you are is
 * worth knowing before you try to change something.
 */
function ProjectRef({ projectId }: { projectId: string | null | undefined }) {
  const session = useSession();
  const scope = session.data?.scope ?? null;

  if (!projectId) return <>—</>;
  if (scope?.projectId !== projectId) return <>{projectId}</>;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {projectId}
      <Badge tone="outline">{scope.projectName}</Badge>
    </span>
  );
}
