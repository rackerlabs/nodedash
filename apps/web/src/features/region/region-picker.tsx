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

import type { Region } from '@nodedash/shared';
import { Check, ChevronsUpDown, Globe } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/misc';
import { useRegions, useSession, useSetRegion } from '@/features/auth/session';
import { errorMessage } from '@/lib/api/client';

/** Full-page choice shown after sign-in when Keystone offers more than one region. */
export function RegionChooser({ regions }: { regions: Region[] }) {
  const setRegion = useSetRegion();

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-4 text-primary" />
            Choose a region
          </CardTitle>
          <CardDescription>
            Nodes are managed through each region&apos;s Ironic. You can switch region later from the header.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {regions.map((region) => (
            <Button
              key={region.id}
              variant="outline"
              className="h-auto w-full justify-start gap-3 py-2 text-left"
              disabled={setRegion.isPending}
              onClick={() => setRegion.mutate(region.id)}
            >
              {setRegion.isPending && setRegion.variables === region.id ? <Spinner /> : <Globe />}
              <span className="flex flex-col">
                <span className="font-mono text-sm">{region.id}</span>
                {region.description ? (
                  <span className="text-xs font-normal text-muted-foreground">{region.description}</span>
                ) : null}
              </span>
            </Button>
          ))}
          {setRegion.isError ? <p className="text-sm text-destructive">{errorMessage(setRegion.error)}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

/** Header control for the current region. Hidden when there is nothing to switch to. */
export function RegionMenu() {
  const session = useSession();
  const regions = useRegions();
  const setRegion = useSetRegion();
  const navigate = useNavigate();

  const current = session.data?.region ?? null;
  const list = regions.data?.regions ?? [];
  if (!current || list.length < 2) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label={`Region ${current}`}>
          <Globe className="size-4 text-muted-foreground" />
          <span className="font-mono text-xs">{current}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Switching region clears the selected project.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {list.map((region) => (
          <DropdownMenuItem
            key={region.id}
            disabled={setRegion.isPending}
            onSelect={() => {
              if (region.id === current) return;
              setRegion.mutate(region.id, { onSuccess: () => void navigate('/nodes') });
            }}
          >
            <Check className={region.id === current ? 'opacity-100' : 'opacity-0'} />
            <span className="flex flex-col">
              <span className="font-mono text-xs">{region.id}</span>
              {region.description ? (
                <span className="text-xs text-muted-foreground">{region.description}</span>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
