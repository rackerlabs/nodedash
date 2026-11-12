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

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  canRunServiceSteps,
  nodeDisplayName,
  runbookMatchesNode,
  type Runbook,
} from '@nodedash/shared';
import { BookOpen, Play, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox, Empty, Label, Skeleton, Spinner } from '@/components/ui/misc';
import { useCapabilities } from '@/features/auth/session';
import { useNodeInvalidator } from '@/features/node/use-node';
import { errorMessage } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';

export function NodeRunbooksPage() {
  const { node, row } = useNodeContext();
  const capabilities = useCapabilities();
  const [selected, setSelected] = useState<Runbook | null>(null);

  const query = useQuery({
    queryKey: qk.runbooks,
    queryFn: () => api.runbooks(),
    staleTime: 5 * 60_000,
  });

  const runbookTraits = capabilities.data?.capabilities.runbookTraits ?? false;
  const nodeTraits = node.traits ?? [];

  const { matching, other } = useMemo(() => {
    const runbooks = query.data?.runbooks ?? [];
    const matchingRunbooks: Runbook[] = [];
    const otherRunbooks: Runbook[] = [];
    for (const runbook of runbooks) {
      if (runbookMatchesNode(runbook, nodeTraits, { runbookTraits })) matchingRunbooks.push(runbook);
      else otherRunbooks.push(runbook);
    }
    return { matching: matchingRunbooks, other: otherRunbooks };
  }, [query.data, nodeTraits, runbookTraits]);

  const eligibility = canRunServiceSteps(row);
  const servicing = row.provisionState === 'servicing' || row.provisionState === 'service wait';

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) {
    return <ErrorPanel title="Could not load runbooks" error={query.error} onRetry={() => void query.refetch()} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Runbooks are predefined step sequences applied through Ironic&apos;s <code>service</code> verb.
          {runbookTraits
            ? ' A runbook is offered when it declares a trait this node carries.'
            : ' This API predates runbook traits, so a runbook is offered when its name matches one of the node’s traits.'}
        </p>

        {servicing ? (
          <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            <Spinner className="size-4" />
            A service operation is running on this node. Steps are applied in order and the node returns to{' '}
            <span className="font-mono">active</span> when they finish.
          </div>
        ) : !eligibility.allowed ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            {eligibility.reason}
          </div>
        ) : null}
      </div>

      {matching.length === 0 ? (
        <Empty
          icon={<BookOpen />}
          title="No runbooks match this node"
          description={
            nodeTraits.length === 0
              ? 'This node carries no traits, so no runbook can be matched to it.'
              : `None of the ${query.data.runbooks.length} runbooks declare a trait this node carries (${nodeTraits.join(', ')}).`
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {matching.map((runbook) => (
            <RunbookCard
              key={runbook.uuid}
              runbook={runbook}
              nodeTraits={nodeTraits}
              disabled={!eligibility.allowed || servicing}
              onRun={() => setSelected(runbook)}
            />
          ))}
        </div>
      )}

      {other.length > 0 ? (
        <details className="rounded-lg border border-border bg-card/50 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">
            {other.length} runbook{other.length === 1 ? '' : 's'} that do not match this node
          </summary>
          <ul className="mt-3 space-y-2">
            {other.map((runbook) => (
              <li key={runbook.uuid} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-[12px]">{runbook.name}</span>
                <span className="text-muted-foreground">requires</span>
                {(runbook.traits ?? [runbook.name]).map((trait) => (
                  <Badge key={trait} tone="outline" className="font-mono text-[10px]">
                    {trait}
                  </Badge>
                ))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <RunRunbookDialog runbook={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function RunbookCard({
  runbook,
  nodeTraits,
  disabled,
  onRun,
}: {
  runbook: Runbook;
  nodeTraits: readonly string[];
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-[13px]">
          {runbook.name}
          {runbook.public ? <Badge tone="outline">public</Badge> : null}
        </CardTitle>
        <CardDescription>{runbook.description ?? 'No description provided.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(runbook.traits ?? [runbook.name]).map((trait) => (
            <Badge key={trait} tone={nodeTraits.includes(trait) ? 'active' : 'outline'} className="font-mono text-[10px]">
              {trait}
            </Badge>
          ))}
        </div>
        <ol className="space-y-1 text-xs text-muted-foreground">
          {runbook.steps.map((step, index) => (
            <li key={`${step.interface}.${step.step}-${index}`} className="flex gap-2">
              <span className="tabular">{index + 1}.</span>
              <span className="font-mono">
                {step.interface}.{step.step}
              </span>
            </li>
          ))}
        </ol>
        <Button size="sm" className="w-full gap-2" disabled={disabled} onClick={onRun}>
          <Play className="size-4" />
          Run runbook
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Running a runbook executes vendor steps against real hardware, so the dialog
 * shows exactly what will run and asks for an explicit acknowledgement — plus the
 * node name typed out when a tenant instance is on the box.
 */
function RunRunbookDialog({ runbook, onClose }: { runbook: Runbook | null; onClose: () => void }) {
  const { row } = useNodeContext();
  const invalidate = useNodeInvalidator(row.uuid);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState('');

  const needsTyped = Boolean(row.instanceUuid);
  const expected = nodeDisplayName(row);

  const run = useMutation({
    mutationFn: () => api.runRunbook(row.uuid, runbook!.name),
    onSuccess: () => {
      toast.success(`Running ${runbook?.name}`, {
        description: 'Ironic moved the node to servicing. Progress updates on this page.',
      });
      invalidate();
      close();
    },
    onError: (error) => toast.error('Could not start the runbook', { description: errorMessage(error) }),
  });

  function close() {
    setAcknowledged(false);
    setTyped('');
    onClose();
  }

  const ready = acknowledged && (!needsTyped || typed.trim() === expected);

  return (
    <Dialog open={runbook !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-warning" />
            Run <span className="font-mono text-[13px]">{runbook?.name}</span>
          </DialogTitle>
          <DialogDescription>{runbook?.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Steps that will run
            </p>
            <pre className="max-h-56 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(runbook?.steps ?? [], null, 2)}
            </pre>
          </div>

          {needsTyped ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              This node is running instance{' '}
              <span className="font-mono text-[12px]">{row.instanceName ?? row.instanceUuid}</span>. Service
              steps can reboot the node or touch its disks.
            </p>
          ) : null}

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              className="mt-0.5"
            />
            <span>I have read the steps above and want to apply them to {expected}.</span>
          </label>

          {needsTyped ? (
            <div className="space-y-2">
              <Label htmlFor="runbook-confirm">
                Type <span className="font-mono font-semibold">{expected}</span> to confirm
              </Label>
              <Input
                id="runbook-confirm"
                value={typed}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
                placeholder={expected}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!ready || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Spinner /> : <Play />}
            Run runbook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
