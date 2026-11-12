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

import { Terminal } from 'lucide-react';
import { useSearchParams } from 'react-router';

/**
 * Stand-in for the NoVNC page a real graphical console URL would open. It exists
 * so the console flow can be walked end to end in mock mode; nothing here talks
 * to a BMC.
 */
export function MockConsolePage() {
  const [params] = useSearchParams();
  const name = params.get('name') ?? params.get('node') ?? 'unknown node';
  const token = params.get('token') ?? '';

  return (
    <div className="flex min-h-full flex-col bg-black p-6 font-mono text-sm text-green-400">
      <div className="mb-4 flex items-center gap-2 text-green-300">
        <Terminal className="size-4" />
        <span>graphical console — {name}</span>
        <span className="ml-auto text-xs text-green-700">token {token.slice(0, 12)}…</span>
      </div>
      <pre className="whitespace-pre-wrap leading-relaxed">
{`[    0.000000] Linux version 6.8.0-generic
[    0.412551] ACPI: Early table checksum verification disabled
[    1.884210] ixgbe 0000:19:00.0 eno1: detected PHY at address 0
[    2.104733] EXT4-fs (nvme0n1p2): mounted filesystem with ordered data mode
[    3.551002] systemd[1]: Detected architecture x86-64.

Ubuntu 24.04.3 LTS ${name} ttyS0

${name} login: _

(mock console — a real deployment opens the ironic-novncproxy URL here)`}
      </pre>
    </div>
  );
}
