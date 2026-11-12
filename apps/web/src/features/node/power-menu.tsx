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
import {
  isHardPowerTarget,
  nodeDisplayName,
  POWER_TARGET_LABELS,
  POWER_TARGETS,
  requiresTypedConfirmation,
  type NodeRow,
  type PowerTarget,
} from '@nodedash/shared';
import { Power, TriangleAlert, Zap } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label, Spinner } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useNodeInvalidator } from './use-node';

export function PowerMenu({ node, disabled }: { node: NodeRow; disabled?: boolean }) {
  const [pendingTarget, setPendingTarget] = useState<PowerTarget | null>(null);
  const invalidate = useNodeInvalidator(node.uuid);

  const power = useMutation({
    mutationFn: (target: PowerTarget) => api.setPower(node.uuid, target),
    onSuccess: (_result, target) => {
      toast.success(`${POWER_TARGET_LABELS[target]} requested`, {
        description: `Ironic is applying the change to ${nodeDisplayName(node)}.`,
      });
      invalidate();
    },
    onError: (error) => toast.error('Power action failed', { description: errorMessage(error) }),
  });

  function request(target: PowerTarget) {
    if (requiresTypedConfirmation(target, node)) {
      setPendingTarget(target);
      return;
    }
    power.mutate(target);
  }

  const inFlight = Boolean(node.targetPowerState) || power.isPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2" disabled={disabled || inFlight}>
            {inFlight ? <Spinner /> : <Power className="size-4" />}
            Power
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Power actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {POWER_TARGETS.map((target) => {
            const alreadyOn = target === 'power on' && node.powerState === 'power on';
            const alreadyOff =
              (target === 'power off' || target === 'soft power off') && node.powerState === 'power off';
            return (
              <DropdownMenuItem
                key={target}
                disabled={alreadyOn || alreadyOff}
                variant={isHardPowerTarget(target) ? 'destructive' : 'default'}
                onSelect={() => request(target)}
              >
                {isHardPowerTarget(target) ? <Zap /> : <Power />}
                {POWER_TARGET_LABELS[target]}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="font-normal text-xs whitespace-normal">
            Graceful actions ask the operating system to shut down first. Hard actions cut power
            immediately.
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>

      <TypedConfirmDialog
        node={node}
        target={pendingTarget}
        pending={power.isPending}
        onCancel={() => setPendingTarget(null)}
        onConfirm={() => {
          if (!pendingTarget) return;
          power.mutate(pendingTarget, { onSettled: () => setPendingTarget(null) });
        }}
      />
    </>
  );
}

/**
 * Hard power actions on a node running a tenant instance can destroy work, so
 * the node name has to be typed out. It is deliberately more friction than a
 * plain confirm.
 */
function TypedConfirmDialog({
  node,
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  node: NodeRow;
  target: PowerTarget | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const expected = nodeDisplayName(node);
  const matches = typed.trim() === expected;

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          setTyped('');
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="size-4" />
            {target ? POWER_TARGET_LABELS[target] : ''} on a node with a running instance
          </DialogTitle>
          <DialogDescription>
            This node is hosting instance{' '}
            <span className="font-mono text-[12px]">{node.instanceName ?? node.instanceUuid}</span>. A hard
            power action does not give the operating system a chance to shut down and can lose in-flight
            work.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="confirm-node-name">
            Type <span className="font-mono font-semibold">{expected}</span> to confirm
          </Label>
          <Input
            id="confirm-node-name"
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            placeholder={expected}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setTyped('');
              onCancel();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || pending}
            onClick={() => {
              setTyped('');
              onConfirm();
            }}
          >
            {pending ? <Spinner /> : <Zap />}
            {target ? POWER_TARGET_LABELS[target] : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
