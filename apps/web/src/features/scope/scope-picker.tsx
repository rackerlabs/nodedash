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

import { useQuery } from '@tanstack/react-query';
import type { Project, Scope } from '@nodedash/shared';
import { Building2, Clock, FolderOpen, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/misc';
import { toast } from 'sonner';
import { useSetScope } from '@/features/auth/session';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { rankProjects } from './rank';
import { forgetScope, readRecentScopes, rememberScope } from './recents';
import { useDebounced } from './use-debounced';

/** Cap on rendered rows: enough to find anything, few enough to stay responsive. */
const VISIBLE_LIMIT = 200;

export function ScopePickerDialog({
  open,
  onOpenChange,
  onSelected,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelected?: (scope: Scope) => void;
  dismissible?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={dismissible ? onOpenChange : undefined}>
      <DialogContent
        className="max-w-2xl gap-3 p-0"
        showClose={dismissible}
        onEscapeKeyDown={dismissible ? undefined : (event) => event.preventDefault()}
        onInteractOutside={dismissible ? undefined : (event) => event.preventDefault()}
      >
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Select a project</DialogTitle>
          <DialogDescription>
            Nodes are returned per project, so pick the domain and project you want to administer.
          </DialogDescription>
        </DialogHeader>
        <ScopePicker
          onSelected={(scope) => {
            onSelected?.(scope);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ScopePicker({ onSelected }: { onSelected?: (scope: Scope) => void }) {
  const [query, setQuery] = useState('');
  const [domainId, setDomainId] = useState<string | null>(null);
  const debouncedQuery = useDebounced(query, 200);
  const setScope = useSetScope();
  const [recents, setRecents] = useState(() => readRecentScopes());

  const options = useQuery({
    queryKey: qk.scopeOptions(debouncedQuery, domainId),
    queryFn: () => api.scopeOptions({ search: debouncedQuery || undefined, domainId: domainId ?? undefined }),
    // Keep the previous list on screen while a new search resolves.
    placeholderData: (previous) => previous,
  });

  const domains = options.data?.domains ?? [];
  const projects = options.data?.projects ?? [];
  const ranked = useMemo(() => rankProjects(projects, debouncedQuery, VISIBLE_LIMIT), [projects, debouncedQuery]);
  const hiddenCount = Math.max(0, projects.length - ranked.length);

  const domainName = (project: Project) =>
    domains.find((domain) => domain.id === project.domain_id)?.name ?? project.domain_id;

  async function choose(project: Project) {
    try {
      const session = await setScope.mutateAsync(project.id);
      if (session.scope) {
        rememberScope(session.scope);
        onSelected?.(session.scope);
      }
    } catch (error) {
      // A remembered project can disappear or have its access revoked; drop it
      // from the list instead of leaving a dead entry the operator keeps hitting.
      setRecents(forgetScope(project.id));
      toast.error(`Could not switch to ${project.name}`, { description: errorMessage(error) });
    }
  }

  /**
   * Recents are per-browser and can outlive the project they point at, so drop any
   * the server no longer offers rather than leaving a dead entry to click. Only
   * safe when the list is complete: a truncated result means absence proves
   * nothing, so in that case the reactive cleanup in `choose` handles it.
   */
  const visibleRecents = useMemo(() => {
    if (options.data === undefined || options.data.truncated || debouncedQuery) return recents;
    const known = new Set(options.data.projects.map((project) => project.id));
    return recents.filter((scope) => known.has(scope.projectId));
  }, [recents, options.data, debouncedQuery]);

  const showRecents = !debouncedQuery && visibleRecents.length > 0 && !domainId;

  return (
    <div className="flex flex-col">
      {domains.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Domain</span>
          <DomainChip active={domainId === null} onClick={() => setDomainId(null)}>
            All
          </DomainChip>
          {domains.map((domain) => (
            <DomainChip
              key={domain.id}
              active={domainId === domain.id}
              onClick={() => setDomainId(domainId === domain.id ? null : domain.id)}
            >
              {domain.name}
            </DomainChip>
          ))}
        </div>
      ) : null}

      <Command shouldFilter={false} loop className="border-t border-border">
        <CommandInput
          autoFocus
          placeholder="Search projects by name, id or description…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {options.isError ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-destructive">
              <TriangleAlert className="size-4" />
              {errorMessage(options.error)}
            </div>
          ) : null}

          {!options.isError && ranked.length === 0 && !options.isFetching ? (
            <CommandEmpty>No projects match “{query}”.</CommandEmpty>
          ) : null}

          {showRecents ? (
            <CommandGroup heading="Recent">
              {visibleRecents.map((scope) => (
                <CommandItem
                  key={`recent-${scope.projectId}`}
                  value={`recent-${scope.projectId}`}
                  onSelect={() => {
                    void choose({
                      id: scope.projectId,
                      name: scope.projectName,
                      domain_id: scope.domainId,
                    } as Project);
                  }}
                >
                  <Clock className="size-4 text-muted-foreground" />
                  <span className="font-medium">{scope.projectName}</span>
                  <Badge tone="outline" className="ml-auto">
                    {scope.domainName}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {ranked.length > 0 ? (
            <CommandGroup heading={debouncedQuery ? 'Matches' : 'All projects'}>
              {ranked.map(({ project }) => (
                <CommandItem key={project.id} value={project.id} onSelect={() => void choose(project)}>
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{project.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground tabular">
                    {project.id}
                  </span>
                  <Badge tone="outline" className="ml-auto shrink-0">
                    <Building2 className="size-3" />
                    {domainName(project)}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>

      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {options.isFetching ? <Spinner className="size-3.5" /> : null}
          {hiddenCount > 0
            ? `Showing ${ranked.length} of ${projects.length}${options.data?.truncated ? '+' : ''} matches — refine your search`
            : `${projects.length}${options.data?.truncated ? '+' : ''} project${projects.length === 1 ? '' : 's'} available`}
        </span>
        {setScope.isPending ? (
          <span className="flex items-center gap-2">
            <Spinner className="size-3.5" /> Scoping token…
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DomainChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      className={cn('h-6 rounded-full px-2.5 text-xs', !active && 'text-muted-foreground')}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
