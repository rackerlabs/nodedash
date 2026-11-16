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
import { Navigate, Outlet, useLocation, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/misc';
import { useRegions, useSession, useSetRegion, useSetScope } from '@/features/auth/session';
import { RegionChooser } from '@/features/region/region-picker';
import { ScopePickerDialog } from '@/features/scope/scope-picker';
import { errorMessage, isUnauthenticated } from '@/lib/api/client';
import { nodesPath, useRegionPaths } from '@/lib/paths';
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
 * Each region has its own Ironic, found in the Keystone catalog, and the region in
 * the URL is the one the page is about. The session cookie still carries the region
 * the BFF calls, so this guard makes the two agree before anything node-shaped
 * renders. With a single cookie, the tab that synced last decides what the BFF sees.
 */
export function RequireRegion() {
  const { region = '' } = useParams();
  const session = useSession();
  const regions = useRegions();
  const setRegion = useSetRegion();
  const requested = useRef<string | null>(null);

  const current = session.data?.region ?? null;
  const list = regions.data?.regions ?? [];
  const known = list.some((candidate) => candidate.id === region);

  useEffect(() => {
    if (current === region) {
      requested.current = null;
      return;
    }
    // One request per mismatch; if another tab moves the cookie away again, the
    // session refetch lands here with the ref cleared and syncs it back.
    if (!known || requested.current === region) return;
    requested.current = region;
    setRegion.mutate(region);
  }, [current, region, known, setRegion]);

  if (regions.isError) {
    return <ErrorPanel title="Could not list regions" error={regions.error} onRetry={() => void regions.refetch()} />;
  }
  if (regions.isPending) return <FullPageSpinner label="Loading regions…" />;
  if (!known) {
    return (
      <RegionChooser
        regions={list}
        notice={`Region ${region} is not available to your account. Choose one of the regions below.`}
      />
    );
  }
  if (setRegion.isError) {
    return (
      <ErrorPanel
        title={`Could not select region ${region}`}
        error={setRegion.error}
        onRetry={() => {
          requested.current = null;
          setRegion.reset();
        }}
      />
    );
  }
  if (current !== region) return <FullPageSpinner label={`Switching to ${region}…`} />;

  return <Outlet />;
}

/**
 * Landing for URLs without a region: `/` and the post-login default. It sends them
 * to the region the session last used, or asks when there is more than one.
 */
export function RegionEntry() {
  const session = useSession();
  const location = useLocation();
  const region = session.data?.region ?? null;
  const regions = useRegions(!region);

  const target = (id: string) => `${nodesPath(id)}${location.search}`;

  if (region) return <Navigate to={target(region)} replace />;

  const list = regions.data?.regions ?? [];
  if (regions.isError) {
    return <ErrorPanel title="Could not list regions" error={regions.error} onRetry={() => void regions.refetch()} />;
  }
  if (regions.isPending) return <FullPageSpinner label="Loading regions…" />;
  if (list.length === 0) {
    return (
      <ErrorPanel title="No regions available">
        <p className="text-sm text-muted-foreground">Keystone did not list any regions for your account.</p>
      </ErrorPanel>
    );
  }
  // With one region there is nothing to choose.
  if (list.length === 1) return <Navigate to={target(list[0]!.id)} replace />;

  return <RegionChooser regions={list} target={target} />;
}

/** Inside a region, unknown paths mean the fleet view. */
export function RegionHome() {
  const { nodes } = useRegionPaths();
  return <Navigate to={nodes} replace />;
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
