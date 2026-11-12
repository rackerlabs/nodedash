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

import { type Branding, DEFAULT_BRANDING } from '@nodedash/shared';
import { Server } from 'lucide-react';
import { useEffect } from 'react';
import { useSession } from '@/features/auth/session';
import { cn } from '@/lib/utils';

/** The deployment's branding, from the session; the defaults until it loads. */
export function useBranding(): Branding {
  return useSession().data?.branding ?? DEFAULT_BRANDING;
}

/** The configured logo, or the default icon when none is set. */
export function BrandMark({ className }: { className?: string }) {
  const { name, logoUrl } = useBranding();
  if (logoUrl) return <img src={logoUrl} alt={name} className={cn('object-contain', className)} />;
  return <Server className={cn('text-primary', className)} aria-hidden />;
}

/** Keeps the tab title on the configured name. Renders nothing. */
export function BrandTitle() {
  const { name } = useBranding();
  useEffect(() => {
    document.title = name;
  }, [name]);
  return null;
}
