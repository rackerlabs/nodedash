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

import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { RequireAuth, RequireRegion, RequireScope } from './guards';
import { LoginPage } from './login';
import { MockConsolePage } from './mock-console';
import { NodeBiosPage } from './node/bios';
import { NodeFirmwarePage } from './node/firmware';
import { NodeHealthPage } from './node/health';
import { NodeInventoryPage } from './node/inventory';
import { NodeLayout } from './node/layout';
import { NodeLogsPage } from './node/logs';
import { NodeOverviewPage } from './node/overview';
import { NodeRunbooksPage } from './node/runbooks';
import { NodeSupportAssistPage } from './node/support-assist';
import { NodesPage } from './nodes';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/mock-console', element: <MockConsolePage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        // Every node request goes to one region's Ironic, so pick that first.
        element: <RequireRegion />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <Navigate to="/nodes" replace /> },
              {
                // The fleet view needs a project up front; a node deep link does not,
                // because the node route resolves its own scope from the UUID.
                element: <RequireScope />,
                children: [{ path: 'nodes', element: <NodesPage /> }],
              },
              {
                path: 'nodes/:uuid',
                element: <NodeLayout />,
                children: [
                  { index: true, element: <NodeOverviewPage /> },
                  { path: 'health', element: <NodeHealthPage /> },
                  { path: 'inventory', element: <NodeInventoryPage /> },
                  { path: 'bios', element: <NodeBiosPage /> },
                  { path: 'firmware', element: <NodeFirmwarePage /> },
                  { path: 'logs', element: <NodeLogsPage /> },
                  { path: 'runbooks', element: <NodeRunbooksPage /> },
                  { path: 'support-assist', element: <NodeSupportAssistPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/nodes" replace /> },
]);
