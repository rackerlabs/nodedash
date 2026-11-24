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
import { SupportAssistTaskSchema } from '@nodedash/shared';
import { LifeBuoy, Play } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Empty, Skeleton } from '@/components/ui/misc';
import { useSupportAssist, useSupportAssistSupported } from '@/features/node/use-support-assist';
import { useRegion } from '@/lib/paths';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';
import { ArchivesCard, EulaCard, JobCard, ResumeForm, StartDialog } from './support-assist-panels';

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
      <EulaCard eula={eula} />
      {taskMonitor ? <JobCard job={job} taskMonitor={taskMonitor} validTask={validTask} /> : null}
      <ResumeForm onTrack={track} />
      <ArchivesCard archives={archives} region={region} uuid={row.uuid} />
      <StartDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        canStart={canStart}
        start={start}
        onStarted={track}
      />
    </div>
  );
}
