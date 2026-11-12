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

import { KeyRound, Server, ShieldCheck } from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/misc';
import { useLogin, useSession } from '@/features/auth/session';
import { errorMessage } from '@/lib/api/client';
import { IS_MOCK } from '@/lib/env';
import { FullPageSpinner } from './status';

export function LoginPage() {
  const session = useSession();
  const login = useLogin();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/nodes';

  if (session.isPending) return <FullPageSpinner label="Checking your session…" />;
  if (session.data?.authenticated) return <Navigate to={next} replace />;

  const providers = session.data?.identityProviders ?? [];

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Server className="size-8 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">nodedash</h1>
          <p className="text-sm text-muted-foreground">
            Hardware administration for OpenStack Ironic bare metal nodes.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              Sign in with federated identity
            </CardTitle>
            <CardDescription>
              Authentication goes through Keystone WebSSO. Your token is kept in an encrypted cookie that
              this page cannot read.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {providers.map((provider) => (
              <Button
                key={provider.id}
                className="w-full justify-center gap-2"
                disabled={login.isPending}
                onClick={() => login.mutate({ idp: provider.id, next })}
              >
                {login.isPending ? <Spinner /> : <KeyRound />}
                Continue with {provider.label ?? provider.id}
                {/* The protocol only disambiguates when more than one IdP is offered. */}
                {providers.length > 1 ? (
                  <span className="font-mono text-[11px] opacity-70">{provider.protocol}</span>
                ) : null}
              </Button>
            ))}

            {providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No identity providers are configured. Set the WebSSO protocol and IdP list on the server.
              </p>
            ) : null}

            {login.isError ? (
              <p className="text-sm text-destructive">{errorMessage(login.error)}</p>
            ) : null}

            {IS_MOCK ? (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                Mock mode: sign-in is simulated locally and no Keystone request is made.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
