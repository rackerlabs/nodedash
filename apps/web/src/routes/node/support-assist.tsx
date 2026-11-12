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
  SUPPORT_ASSIST_SELECTORS,
  defaultSelectorIds,
  isSupportAssistDownloadable,
  requestTouchesPii,
  supportAssistTone,
  type SupportAssistCollection,
  type SupportAssistSelectorId,
} from '@nodedash/shared';
import { Download, LifeBuoy, Play, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox, Empty, Progress, Skeleton, Spinner } from '@/components/ui/misc';
import {
  activeCollection,
  useSupportAssist,
  useSupportAssistSupported,
} from '@/features/node/use-support-assist';
import { errorMessage } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatBytes, formatTimestamp, relativeTime, timeUntil } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';

export function NodeSupportAssistPage() {
  const { node, row } = useNodeContext();
  const { supported, isPending: supportPending } = useSupportAssistSupported(row.uuid);
  const { query, start } = useSupportAssist(row.uuid, { enabled: supported });
  const [dialogOpen, setDialogOpen] = useState(false);

  if (supportPending) return <Skeleton className="h-64 w-full" />;

  if (!supported) {
    return (
      <Empty
        icon={<LifeBuoy />}
        title="This node cannot collect a SupportAssist bundle"
        description={`SupportAssist comes from Dell's iDRAC OEM calls, which Ironic only exposes on the idrac hardware type. This node uses the ${
          node.driver ?? 'unknown'
        } driver.`}
      />
    );
  }

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) {
    return (
      <ErrorPanel
        title="Could not load SupportAssist collections"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const collections = query.data?.collections ?? [];
  const running = activeCollection(collections);
  // The running one is already featured above with its progress; listing it again
  // below just says the same thing twice.
  const finished = collections.filter((collection) => collection.id !== running?.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          A SupportAssist collection is the bundle Dell support asks for on a hardware case: the BMC
          gathers hardware logs, configuration and optionally OS-side data into one archive, which is
          uploaded to storage and downloadable here. Collections take a while — you can leave this page and
          come back.
        </p>
        <Button size="sm" className="gap-2" disabled={running !== null} onClick={() => setDialogOpen(true)}>
          <Play className="size-4" />
          Collect bundle
        </Button>
      </div>

      {running ? <RunningCollection collection={running} /> : null}

      {finished.length === 0 ? (
        running ? null : (
          <Empty
            icon={<LifeBuoy />}
            title="No collections yet"
            description="Nothing has been collected from this node. Starting one takes around half an hour."
          />
        )
      ) : (
        <div className="space-y-2">
          {finished.map((collection) => (
            <CollectionRow key={collection.id} collection={collection} nodeUuid={row.uuid} />
          ))}
        </div>
      )}

      <CollectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        pending={start.isPending}
        onSubmit={(request) => {
          start.mutate(request, {
            onSuccess: () => {
              toast.success('SupportAssist collection started', {
                description: 'The BMC is gathering data. Progress shows on this page.',
              });
              setDialogOpen(false);
            },
            onError: (error) =>
              toast.error('Could not start the collection', { description: errorMessage(error) }),
          });
        }}
      />
    </div>
  );
}

const PHASE_LABELS: Record<string, string> = {
  queued: 'Queued on the BMC',
  collecting: 'Collecting data from the node',
  uploading: 'Uploading the bundle to storage',
};

function RunningCollection({ collection }: { collection: SupportAssistCollection }) {
  const now = useNow(1_000);
  const estimated = collection.estimated_completion_at
    ? new Date(collection.estimated_completion_at).getTime()
    : null;
  const remainingMs = estimated === null ? null : estimated - now;

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Spinner className="size-4" />
          {PHASE_LABELS[collection.state] ?? 'Collection in progress'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={collection.percent} label="Collection progress" />
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            Started {relativeTime(collection.started_at, now)}
            {collection.requested_by ? ` by ${collection.requested_by}` : null}
          </span>
          {collection.percent !== null && collection.percent !== undefined ? (
            <span className="tabular">{collection.percent}% complete</span>
          ) : null}
          {remainingMs !== null ? (
            <span>
              {remainingMs > 60_000
                ? `about ${Math.round(remainingMs / 60_000)} min remaining`
                : remainingMs > 0
                  ? 'less than a minute remaining'
                  : 'finishing up'}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          This runs on the BMC, not in your browser. Closing this page will not stop it.
        </p>
      </CardContent>
    </Card>
  );
}

/** Bundles hold data with a retention window, so say which side of it we are on. */
function expiryLabel(expiresAt: string, now: number): string {
  return new Date(expiresAt).getTime() > now
    ? `expires ${timeUntil(expiresAt, now)}`
    : `expired ${relativeTime(expiresAt, now)}`;
}

function CollectionRow({
  collection,
  nodeUuid,
}: {
  collection: SupportAssistCollection;
  nodeUuid: string;
}) {
  const now = useNow(30_000);
  const started = new Date(collection.started_at).getTime();
  const finished = collection.finished_at ? new Date(collection.finished_at).getTime() : null;
  const durationMin = finished ? Math.max(1, Math.round((finished - started) / 60_000)) : null;
  const holdsPii = requestTouchesPii(collection.data_selectors, {
    filterPii: collection.filter_pii,
  });

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-card/50 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={supportAssistTone(collection.state)}>{collection.state}</Badge>
          <span className="font-mono text-[12px] break-all">
            {collection.filename ?? collection.id}
          </span>
          {holdsPii ? (
            <Badge tone="error" className="gap-1">
              <ShieldAlert className="size-3" />
              unfiltered OS data
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Started {formatTimestamp(collection.started_at)}</span>
          {durationMin ? <span>took ~{durationMin} min</span> : null}
          {collection.size_bytes ? <span>{formatBytes(collection.size_bytes)}</span> : null}
          {collection.requested_by ? <span>by {collection.requested_by}</span> : null}
          {collection.expires_at ? <span>{expiryLabel(collection.expires_at, now)}</span> : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {collection.data_selectors.map((selector) => (
            <Badge key={selector} tone="outline" className="font-mono text-[10px]">
              {selector}
            </Badge>
          ))}
        </div>

        {collection.error ? (
          <p className="text-xs text-destructive">{collection.error}</p>
        ) : null}
      </div>

      {isSupportAssistDownloadable(collection) ? (
        <Button variant="outline" size="sm" className="gap-2" asChild>
          {/* A real link: the server redirects to storage and the browser downloads it. */}
          <a href={api.supportAssistDownloadUrl(nodeUuid, collection.id)}>
            <Download className="size-4" />
            Download
          </a>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Choosing what to collect is a data-handling decision, not just a technical one:
 * OS and application data pulls files off a running host, which on a tenant node
 * means customer data. PII filtering is on by default and turning it off has to be
 * deliberate.
 */
function CollectDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (request: {
    data_selectors: SupportAssistSelectorId[];
    filter_pii: boolean;
  }) => void;
}) {
  const { row } = useNodeContext();
  const [selected, setSelected] = useState<SupportAssistSelectorId[]>(() => defaultSelectorIds());
  const [filterPii, setFilterPii] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);

  const exposesPii = requestTouchesPii(selected, { filterPii });
  const ready = selected.length > 0 && (!exposesPii || acknowledged);

  function toggle(id: SupportAssistSelectorId, on: boolean) {
    setSelected((current) => (on ? [...current, id] : current.filter((entry) => entry !== id)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Collect a SupportAssist bundle</DialogTitle>
          <DialogDescription>
            The BMC gathers the selected data into one archive. This usually takes around 30 minutes and
            does not reboot the node.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {SUPPORT_ASSIST_SELECTORS.map((selector) => (
            <label key={selector.id} className="flex cursor-pointer items-start gap-2.5 text-sm">
              <Checkbox
                checked={selected.includes(selector.id)}
                onCheckedChange={(checked) => toggle(selector.id, checked === true)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {selector.label}
                  <span className="font-mono text-[10px] text-muted-foreground">{selector.id}</span>
                  {selector.containsPii ? (
                    <Badge tone="error" className="gap-1">
                      <ShieldAlert className="size-3" />
                      customer data
                    </Badge>
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">{selector.description}</span>
              </span>
            </label>
          ))}

          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm">
            <Checkbox
              checked={filterPii}
              onCheckedChange={(checked) => setFilterPii(checked === true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Filter personally identifiable information</span>
              <span className="block text-xs text-muted-foreground">
                Asks the BMC to scrub hostnames, addresses and user data from the bundle before it is
                written. Leave this on unless Dell support has asked for the unfiltered collection.
              </span>
            </span>
          </label>

          {exposesPii ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <p className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  This bundle will contain unfiltered data from the running host
                  {row.instanceName || row.instanceUuid ? (
                    <>
                      , which is currently running instance{' '}
                      <span className="font-mono text-[12px]">
                        {row.instanceName ?? row.instanceUuid}
                      </span>
                    </>
                  ) : null}
                  . Treat the download as customer data.
                </span>
              </p>
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(checked) => setAcknowledged(checked === true)}
                  className="mt-0.5"
                />
                <span>I have authorisation to collect unfiltered customer data from this node.</span>
              </label>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!ready || pending}
            onClick={() => onSubmit({ data_selectors: selected, filter_pii: filterPii })}
          >
            {pending ? <Spinner /> : <Play />}
            Start collection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
