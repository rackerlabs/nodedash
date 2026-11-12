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

import { FlaskConical } from 'lucide-react';
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
import { IS_MOCK } from '@/lib/env';
import { activeScenario, SCENARIOS, setScenario } from '@/mocks/scenario';

/**
 * Only rendered in mock mode. Lets a reviewer jump between fleet sizes, an old
 * API and a failing backend without touching code.
 */
export function ScenarioSwitcher() {
  if (!IS_MOCK) return null;
  const current = activeScenario();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FlaskConical className="size-4 text-warning" />
          <span className="hidden sm:inline">Mock:</span>
          <span className="font-medium">{current.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Mock scenario</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SCENARIOS.map((scenario) => (
          <DropdownMenuItem
            key={scenario.id}
            className="flex-col items-start gap-0.5 py-2"
            onSelect={() => setScenario(scenario.id)}
          >
            <span className="flex w-full items-center gap-2 font-medium">
              {scenario.label}
              {scenario.id === current.id ? (
                <Badge tone="active" className="ml-auto">
                  active
                </Badge>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">{scenario.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
