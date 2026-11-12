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

import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/misc';
import { useRegions, useSession, useSetRegion, useSetScope } from '@/features/auth/session';
import { RegionChooser } from '@/features/region/region-picker';
import { ScopePickerDialog } from '@/features/scope/scope-picker';
import { errorMessage, isUnauthenticated } from '@/lib/api/client';
import { ErrorPanel, FullPageSpinner } from './status';

export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <FullPageSpinner label="Checking your session…" />;

  if (session.isError && !isUnauthenticated(session.error)) {
    return <ErrorPanel title="Could not load your session" error={session.error} onRetry={() => void session.refetch()} />;
  }

  if (!session.data?.authenticated) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return <Outlet />;
}

/**
 * Each region has its own Ironic, found in the Keystone catalog, so a region is
 * chosen before anything node-shaped is asked for. With a single region there is
 * nothing to choose and it is selected without asking.
 */
export function RequireRegion() {
  const session = useSession();
  const region = session.data?.region ?? null;
  const regions = useRegions(!region);
  const setRegion = useSetRegion();
  const adopted = useRef(false);

  const list = regions.data?.regions ?? [];
  const only = list.length === 1 ? list[0]! : null;

  useEffect(() => {
    if (region || !only || adopted.current) return;
    adopted.current = true;
    setRegion.mutate(only.id);
  }, [region, only, setRegion]);

  if (region) return <Outlet />;

  if (regions.isError) {
    return <ErrorPanel title="Could not list regions" error={regions.error} onRetry={() => void regions.refetch()} />;
  }
  if (setRegion.isError && only) {
    return <ErrorPanel title={`Could not select region ${only.id}`} error={setRegion.error} />;
  }
  if (regions.isPending || only) return <FullPageSpinner label="Loading regions…" />;
  if (list.length === 0) {
    return (
      <ErrorPanel title="No regions available">
        <p className="text-sm text-muted-foreground">Keystone did not list any regions for your account.</p>
      </ErrorPanel>
    );
  }

  return <RegionChooser regions={list} />;
}

/**
 * Ironic answers per project, so most routes need a scoped token. If the session
 * remembers the last project we adopt it silently — an operator who bookmarked
 * the fleet view should not have to pick a project every visit.
 */
export function RequireScope() {
  const session = useSession();
  const setScope = useSetScope();
  const [pickerOpen, setPickerOpen] = useState(false);
  const adopted = useRef(false);

  const scope = session.data?.scope ?? null;
  const lastScope = session.data?.lastScope ?? null;

  useEffect(() => {
    if (scope || adopted.current) return;
    if (lastScope) {
      adopted.current = true;
      setScope.mutate(lastScope.projectId);
    } else {
      setPickerOpen(true);
    }
  }, [scope, lastScope, setScope]);

  if (scope) return <Outlet />;

  if (setScope.isPending) return <FullPageSpinner label="Restoring your last project…" />;

  return (
    <>
      <Empty
        title="No project selected"
        description={
          setScope.isError
            ? `Your last project is no longer available (${errorMessage(setScope.error)}). Pick another one.`
            : 'Choose a domain and project to list its bare metal nodes.'
        }
        action={<Button onClick={() => setPickerOpen(true)}>Select a project</Button>}
      />
      <ScopePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} dismissible={false} />
    </>
  );
}
