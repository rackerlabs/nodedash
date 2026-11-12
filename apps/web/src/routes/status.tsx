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

import { TriangleAlert } from 'lucide-react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api/client';

export function FullPageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
      <Spinner className="size-6" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorPanel({
  title = 'Something went wrong',
  error,
  onRetry,
  children,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-20 text-center">
      <TriangleAlert className="size-7 text-destructive" />
      <h2 className="text-base font-semibold">{title}</h2>
      {error ? <p className="text-sm text-muted-foreground">{errorMessage(error)}</p> : null}
      {children}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
