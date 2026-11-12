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

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** UUIDs get pasted into tickets and CLI commands constantly, so make copying cheap. */
export function CopyValue({
  value,
  label,
  className,
  display,
}: {
  value: string;
  label?: string;
  className?: string;
  display?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className={cn('group/copy inline-flex min-w-0 items-center gap-1', className)}>
      <span className="truncate font-mono text-[12px] tabular">{display ?? value}</span>
      <Hint label={copied ? 'Copied' : (label ?? 'Copy')}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="opacity-0 transition-opacity group-hover/copy:opacity-100 focus-visible:opacity-100"
          onClick={copy}
          aria-label={label ?? 'Copy value'}
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </Hint>
    </span>
  );
}
