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
import { extraValueProblem, type IronicNode } from '@nodedash/shared';
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
import { Input } from '@/components/ui/input';
import { Label, Spinner } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useRegion } from '@/lib/paths';
import { useNodeInvalidator } from './use-node';

/**
 * Sets the fields the deployment allows in a node's `extra`. A field the node has
 * never had starts empty and is created on save.
 */
export function ExtraFieldsDialog({
  node,
  fields,
  open,
  onOpenChange,
}: {
  node: IronicNode;
  fields: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const region = useRegion();
  const invalidate = useNodeInvalidator(node.uuid);
  const current = (field: string) => {
    const value = node.extra?.[field];
    return value === undefined || value === null ? '' : String(value);
  };
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field, current(field)])),
  );

  // Only what the operator changed is sent, so saving one field never rewrites
  // another that someone else updated meanwhile. Blank means "leave alone".
  const changes = Object.fromEntries(
    fields
      .filter((field) => draft[field]?.trim() && draft[field].trim() !== current(field))
      .map((field) => [field, draft[field]!.trim()]),
  );
  const problems = Object.entries(changes).flatMap(([field, value]) => {
    const problem = extraValueProblem(value);
    return problem ? [`${field}: ${problem}`] : [];
  });

  const save = useMutation({
    mutationFn: () => api.setExtra(region, node.uuid, changes),
    onSuccess: () => {
      toast.success('Node details updated', { description: Object.keys(changes).join(', ') });
      invalidate();
      onOpenChange(false);
    },
    onError: (error) => toast.error('Could not update node details', { description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit node details</DialogTitle>
          <DialogDescription>
            These are stored in the node&apos;s extra field. Only the fields listed here can be changed from
            this page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={`extra-${field}`} className="font-mono text-xs">
                {field}
              </Label>
              <Input
                id={`extra-${field}`}
                value={draft[field] ?? ''}
                onChange={(event) => setDraft((previous) => ({ ...previous, [field]: event.target.value }))}
                placeholder={node.extra?.[field] === undefined ? 'not set' : undefined}
              />
            </div>
          ))}
          {problems.map((problem) => (
            <p key={problem} className="text-xs text-destructive">
              {problem}
            </p>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={Object.keys(changes).length === 0 || problems.length > 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
