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

import { SupportAssistTaskSchema, supportAssistTone } from '@nodedash/shared';
import { LifeBuoy, Play } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
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
import { Empty, Progress, Skeleton, Spinner } from '@/components/ui/misc';
import { useSupportAssist, useSupportAssistSupported } from '@/features/node/use-support-assist';
import { api } from '@/lib/api/endpoints';
import { useRegion } from '@/lib/paths';
import { formatBytes, formatTimestamp } from '@/lib/format';
import { ApiRequestError, errorMessage } from '@/lib/api/client';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';

export function NodeSupportAssistPage() {
  const region = useRegion();
  const { row } = useNodeContext();
  const capability = useSupportAssistSupported(row.uuid);
  const [params, setParams] = useSearchParams();
  const taskMonitor = params.get('task_monitor') ?? '';
  const validTask = SupportAssistTaskSchema.safeParse({ task_monitor: taskMonitor }).success;
  const { eula, job, start, archives } = useSupportAssist(row.uuid, {
    enabled: capability.supported,
    taskMonitor: validTask ? taskMonitor : '',
  });
  const archivesUnavailable =
    archives.error instanceof ApiRequestError && archives.error.code === 'unsupported';
  const [resume, setResume] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  function track(task_monitor: string) {
    setParams((current) => {
      current.set('task_monitor', task_monitor);
      return current;
    });
  }

  if (capability.isPending) return <Skeleton className="h-64 w-full" />;
  if (capability.isError)
    return (
      <ErrorPanel
        title="Could not discover SupportAssist methods"
        error={capability.error}
        onRetry={() => void capability.refetch()}
      />
    );
  if (!capability.supported)
    return (
      <Empty
        icon={<LifeBuoy />}
        title="This node cannot collect a SupportAssist bundle"
        description="The node’s driver does not expose the required SupportAssist methods."
      />
    );

  // A polling error or an unrecognised handle must not look like a finished job.
  const canStart =
    eula.data?.accepted === true &&
    !eula.isError &&
    !start.isPending &&
    (!taskMonitor || (validTask && job.isSuccess && !job.data.is_processing));
  const status = job.data?.task_state ?? job.data?.job_state ?? 'Unknown';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Collect hardware diagnostics using Ironic’s configured SupportAssist share. The collection runs on
          iDRAC; closing this page will not stop it.
        </p>
        <Button size="sm" disabled={!canStart} onClick={() => setDialogOpen(true)}>
          <Play />
          Collect bundle
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SupportAssist EULA</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {eula.isPending ? (
            <Spinner />
          ) : eula.isError ? (
            <ErrorPanel
              title="Could not read EULA status"
              error={eula.error}
              onRetry={() => void eula.refetch()}
            />
          ) : (
            <p>
              {eula.data.accepted
                ? 'Accepted'
                : 'Not accepted. An authorised operator must accept Dell’s SupportAssist EULA before starting a collection.'}
            </p>
          )}
          <Button variant="outline" size="sm" disabled={eula.isFetching} onClick={() => void eula.refetch()}>
            Refresh EULA status
          </Button>
        </CardContent>
      </Card>

      {taskMonitor ? (
        <Card>
          <CardHeader>
            <CardTitle>Collection job</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="break-all font-mono text-xs">{taskMonitor}</p>
            {!validTask ? (
              <p role="alert">Enter a valid Redfish task monitor or Dell job path.</p>
            ) : job.isPending ? (
              <Spinner />
            ) : job.isError ? (
              <ErrorPanel
                title="Could not poll collection job"
                error={job.error}
                onRetry={() => void job.refetch()}
              />
            ) : (
              <>
                <Badge tone={supportAssistTone(status)}>{status}</Badge>
                {job.data.is_processing ? (
                  <p>Collection in progress. Checking every 10 seconds.</p>
                ) : (
                  <p>
                    {status === 'Completed'
                      ? 'Collection job completed. The archive list refreshes automatically; you can also refresh it manually.'
                      : 'Collection job stopped. Review the status and messages below.'}
                  </p>
                )}
                <Progress value={job.data.percent_complete} label="Collection progress" />
                {job.data.percent_complete !== null ? <p>{job.data.percent_complete}% complete</p> : null}
                <p className="text-xs text-muted-foreground">
                  Task: {job.data.task_state ?? 'Unknown'} · Health: {job.data.task_status ?? 'Unknown'}
                </p>
                {job.data.messages.map((message, index) => (
                  <p key={index} className="text-sm">
                    {message.Message ?? message.MessageId ?? 'No message text'}
                  </p>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={job.isFetching}
                  onClick={() => void job.refetch()}
                >
                  Refresh job status
                </Button>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Bookmark this page to resume polling this job. Ironic does not provide collection history.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          track(resume.trim());
        }}
      >
        <label className="min-w-0 flex-1 text-sm">
          Resume a job
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            value={resume}
            onChange={(event) => setResume(event.target.value)}
            placeholder="/redfish/v1/Managers/iDRAC.Embedded.1/Oem/Dell/Jobs/JID_123"
          />
        </label>
        <Button
          variant="outline"
          type="submit"
          disabled={!SupportAssistTaskSchema.safeParse({ task_monitor: resume.trim() }).success}
        >
          Poll job
        </Button>
      </form>
      <Card>
        <CardHeader>
          <CardTitle>Archives for this node</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Stored ZIPs for this node. Modified times show when files were stored; archives are not linked to
            individual jobs. Downloading does not verify ZIP integrity.
          </p>
          {archives.isPending ? (
            <Spinner />
          ) : archivesUnavailable ? (
            <p className="text-sm text-muted-foreground">{errorMessage(archives.error)}</p>
          ) : archives.isError ? (
            <ErrorPanel
              title="Could not list archives"
              error={archives.error}
              onRetry={() => void archives.refetch()}
            />
          ) : archives.data.length === 0 ? (
            <p>No archives found for this node.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Archive</th>
                    <th>Modified</th>
                    <th>Size</th>
                    <th>
                      <span className="sr-only">Download</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {archives.data.map((archive) => (
                    <tr key={archive.name}>
                      <td className="py-2 pr-4 font-mono text-xs">{archive.name}</td>
                      <td className="pr-4">
                        <time dateTime={archive.modified}>{formatTimestamp(archive.modified)}</time>
                      </td>
                      <td className="pr-4 whitespace-nowrap" title={`${archive.size.toLocaleString()} bytes`}>
                        {formatBytes(archive.size)}
                      </td>
                      <td>
                        <a
                          className="text-primary underline"
                          href={api.supportAssistDownloadUrl(region, row.uuid, archive.name)}
                          download
                        >
                          Download
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!archivesUnavailable && (
            <Button
              variant="outline"
              size="sm"
              disabled={archives.isFetching}
              onClick={() => void archives.refetch()}
            >
              Refresh archives
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Collect a SupportAssist bundle</DialogTitle>
            <DialogDescription>
              Uses Ironic’s defaults: hardware data (HWData), with data filtering off. The archive may contain
              sensitive information. The node is not rebooted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!canStart}
              onClick={() =>
                start.mutate(undefined, {
                  onSuccess: (task) => {
                    track(task.task_monitor);
                    setDialogOpen(false);
                  },
                  onError: (error) =>
                    toast.error('Could not start the collection', { description: errorMessage(error) }),
                })
              }
            >
              {start.isPending ? <Spinner /> : <Play />}Start collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
