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

import { useMutation } from '@tanstack/react-query';
import type { NodeRow } from '@nodedash/shared';
import { Wrench } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Label, Spinner } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useNodeInvalidator } from './use-node';

/** Reasons operators type over and over; offered as one-click fills. */
const REASON_PRESETS = [
  'Hardware fault, awaiting parts',
  'Firmware update in progress',
  'Held for onsite investigation',
  'Failed deployment, under triage',
];

export function MaintenanceDialog({
  node,
  open,
  onOpenChange,
}: {
  node: NodeRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState(node.maintenanceReason ?? '');
  const invalidate = useNodeInvalidator(node.uuid);

  const setMaintenance = useMutation({
    mutationFn: () => api.setMaintenance(node.uuid, reason.trim()),
    onSuccess: () => {
      toast.success('Maintenance mode enabled', { description: reason.trim() });
      invalidate();
      onOpenChange(false);
    },
    onError: (error) => toast.error('Could not set maintenance', { description: errorMessage(error) }),
  });

  const trimmed = reason.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-4 text-destructive" />
            {node.maintenance ? 'Update maintenance reason' : 'Set maintenance mode'}
          </DialogTitle>
          <DialogDescription>
            While a node is in maintenance Ironic will not deploy to it or run provisioning actions
            against it. The reason is stored on the node and shown to everyone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="maintenance-reason">Reason</Label>
          <Textarea
            id="maintenance-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this node being held out of service?"
            autoFocus
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {REASON_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                size="sm"
                className="h-6 rounded-full px-2.5 text-xs text-muted-foreground"
                onClick={() => setReason(preset)}
              >
                {preset}
              </Button>
            ))}
          </div>
          {!trimmed ? (
            <p className="text-xs text-muted-foreground">
              A reason is required so the next person knows why the node is out of service.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!trimmed || setMaintenance.isPending} onClick={() => setMaintenance.mutate()}>
            {setMaintenance.isPending ? <Spinner /> : <Wrench />}
            {node.maintenance ? 'Update reason' : 'Set maintenance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClearMaintenanceDialog({
  node,
  open,
  onOpenChange,
}: {
  node: NodeRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invalidate = useNodeInvalidator(node.uuid);
  const clear = useMutation({
    mutationFn: () => api.clearMaintenance(node.uuid),
    onSuccess: () => {
      toast.success('Maintenance mode cleared');
      invalidate();
      onOpenChange(false);
    },
    onError: (error) => toast.error('Could not clear maintenance', { description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear maintenance mode?</DialogTitle>
          <DialogDescription>
            The node returns to normal scheduling and Ironic will accept provisioning actions again.
          </DialogDescription>
        </DialogHeader>
        {node.maintenanceReason ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Current reason: </span>
            {node.maintenanceReason}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={clear.isPending} onClick={() => clear.mutate()}>
            {clear.isPending ? <Spinner /> : null}
            Clear maintenance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
