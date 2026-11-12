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

import { Building2, ChevronsUpDown, LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/tooltip';
import { useCapabilities, useLogout, useSession } from '@/features/auth/session';
import { BrandMark, useBranding } from '@/features/branding/branding';
import { ScenarioSwitcher } from '@/features/mock/scenario-switcher';
import { RegionMenu } from '@/features/region/region-picker';
import { ScopePickerDialog } from '@/features/scope/scope-picker';
import { applyTheme, readTheme, type Theme } from '@/lib/theme';

export function AppShell() {
  const session = useSession();
  const capabilities = useCapabilities();
  const logout = useLogout();
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // ⌘K / Ctrl+K opens the project switcher from anywhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPickerOpen((open) => !open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const scope = session.data?.scope ?? null;
  const user = session.data?.user ?? null;
  const branding = useBranding();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <Link to="/nodes" className="flex items-center gap-2 font-semibold tracking-tight">
            <BrandMark className="size-5" />
            <span className="hidden sm:inline">{branding.name}</span>
          </Link>

          <RegionMenu />

          <Button
            variant="outline"
            size="sm"
            className="ml-2 max-w-[26rem] gap-2"
            onClick={() => setPickerOpen(true)}
          >
            <Building2 className="size-4 text-muted-foreground" />
            {scope ? (
              <span className="truncate">
                <span className="text-muted-foreground">{scope.domainName}</span>
                <span className="mx-1 text-muted-foreground">/</span>
                <span className="font-medium">{scope.projectName}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Select a project</span>
            )}
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            <kbd className="ml-1 hidden rounded border border-border px-1 text-[10px] text-muted-foreground sm:inline">
              ⌘K
            </kbd>
          </Button>

          <div className="ml-auto flex items-center gap-2">
            {capabilities.data ? (
              <Hint
                label={
                  <span>
                    Negotiated Ironic API microversion {capabilities.data.negotiatedVersion}
                    {capabilities.data.serverMaxVersion
                      ? ` (server supports up to ${capabilities.data.serverMaxVersion})`
                      : ''}
                  </span>
                }
              >
                <Badge tone="outline" className="hidden font-mono text-[11px] md:inline-flex">
                  Ironic {capabilities.data.negotiatedVersion}
                </Badge>
              </Hint>
            ) : null}

            <ScenarioSwitcher />

            <Hint label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun /> : <Moon />}
              </Button>
            </Hint>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <UserRound className="size-4" />
                  <span className="hidden max-w-40 truncate md:inline">{user?.displayName ?? user?.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex flex-col gap-0.5 text-sm font-normal">
                  <span className="font-medium">{user?.displayName ?? user?.name}</span>
                  <span className="text-xs text-muted-foreground">{user?.name}</span>
                  {user?.idp ? (
                    <span className="text-xs text-muted-foreground">
                      Federated via <span className="font-mono">{user.idp}</span>
                    </span>
                  ) : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    logout.mutate(undefined, { onSuccess: () => void navigate('/login') });
                  }}
                >
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <ScopePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onSelected={() => navigate('/nodes')} />
    </div>
  );
}
