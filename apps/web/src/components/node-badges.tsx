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

import { provisionTone } from '@nodedash/shared';
import { Power, PowerOff, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/misc';
import { Hint } from '@/components/ui/tooltip';

export function ProvisionStateBadge({
  state,
  target,
}: {
  state: string | null | undefined;
  target?: string | null;
}) {
  if (!state) return <span className="text-muted-foreground">—</span>;
  const tone = provisionTone(state);
  return (
    <Badge tone={tone} className="font-mono text-[11px]">
      {tone === 'transient' ? <Spinner className="size-3" /> : null}
      {state}
      {target ? <span className="opacity-70">→ {target}</span> : null}
    </Badge>
  );
}

export function PowerStateBadge({
  state,
  target,
}: {
  state: string | null | undefined;
  target?: string | null;
}) {
  if (target) {
    return (
      <Badge tone="transient" className="font-mono text-[11px]">
        <Spinner className="size-3" />
        {target}
      </Badge>
    );
  }
  if (state === 'power on') {
    return (
      <Badge tone="active" className="font-mono text-[11px]">
        <Power className="size-3" />
        on
      </Badge>
    );
  }
  if (state === 'power off') {
    return (
      <Badge tone="neutral" className="font-mono text-[11px]">
        <PowerOff className="size-3" />
        off
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" className="font-mono text-[11px]">
      {state ?? 'unknown'}
    </Badge>
  );
}

export function MaintenanceBadge({
  maintenance,
  reason,
}: {
  maintenance: boolean;
  reason?: string | null;
}) {
  if (!maintenance) return <span className="text-xs text-muted-foreground">no</span>;
  return (
    <Hint label={reason ? reason : 'In maintenance, no reason recorded'}>
      <Badge tone="error">
        <Wrench className="size-3" />
        maintenance
      </Badge>
    </Hint>
  );
}
