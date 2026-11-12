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
import type { NodeRow } from '@nodedash/shared';
import { ExternalLink, MonitorPlay, MonitorX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/misc';
import { Hint } from '@/components/ui/tooltip';
import { useCapabilities } from '@/features/auth/session';
import { CAPABILITY_MICROVERSIONS } from '@nodedash/shared';
import { errorMessage } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';

/** How often to check whether the console has finished coming up. */
const CONSOLE_POLL_MS = 1_500;

/**
 * Enabling a graphical console is a two-step affair: ask Ironic to start it, then
 * read back the proxy URL once it is up. The URL is opened on a separate click so
 * the window.open call happens inside a user gesture and survives popup blockers.
 */
export function ConsoleButton({ node }: { node: NodeRow }) {
  const capabilities = useCapabilities();
  const supported = capabilities.data?.capabilities.graphicalConsole ?? false;

  const consoleState = useQuery({
    queryKey: qk.console(node.uuid),
    queryFn: () => api.console(node.uuid),
    enabled: supported,
    refetchInterval: (query) => (query.state.data?.console_enabled ? false : CONSOLE_POLL_MS),
    refetchIntervalInBackground: true,
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setConsole(node.uuid, enabled),
    onSuccess: (_result, enabled) => {
      if (enabled) toast.info('Starting graphical console…');
      else toast.success('Console disabled');
      void consoleState.refetch();
    },
    onError: (error) => toast.error('Console request failed', { description: errorMessage(error) }),
  });

  if (!supported) {
    return (
      <Hint
        label={`A graphical console needs Ironic API ${CAPABILITY_MICROVERSIONS.graphicalConsole} or newer. This deployment reports ${
          capabilities.data?.negotiatedVersion ?? 'an older version'
        }.`}
      >
        <Button variant="outline" size="sm" className="gap-2" disabled>
          <MonitorX className="size-4" />
          Console
        </Button>
      </Hint>
    );
  }

  const enabled = consoleState.data?.console_enabled ?? false;
  const url = consoleState.data?.console_info?.url ?? null;
  const starting = toggle.isPending || (!enabled && toggle.isSuccess && toggle.variables === true);

  if (!enabled) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={starting}
        onClick={() => toggle.mutate(true)}
      >
        {starting ? <Spinner /> : <MonitorPlay className="size-4" />}
        {starting ? 'Starting console…' : 'Enable console'}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-2">
          <MonitorPlay className="size-4 text-success" />
          Console ready
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="font-normal text-xs whitespace-normal text-muted-foreground">
          The console is served by the Ironic NoVNC proxy and opens in a new window.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!url}
          onSelect={() => {
            if (!url) return;
            // Opened from the click itself so the browser treats it as user-initiated.
            window.open(url, `console-${node.uuid}`, 'noopener,noreferrer');
          }}
        >
          <ExternalLink />
          Open console window
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => toggle.mutate(false)}>
          <MonitorX />
          Disable console
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
