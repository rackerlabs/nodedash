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

// Refreshes apps/web/src/data/pci.ids from upstream and the version recorded in NOTICE.
//
//   npm run update:pci-ids                  # latest from the pciutils/pciids mirror
//   npm run update:pci-ids -- <url|path>    # a specific copy
//
// The file is data from outside the repo, so it is checked before it replaces the
// committed one: the upstream header, a version, the BSD licence option NOTICE relies
// on, and enough vendors to be the real thing. Review the diff before committing.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/pciutils/pciids/master/pci.ids';
const DATA = fileURLToPath(new URL('../apps/web/src/data/pci.ids', import.meta.url));
const NOTICE = fileURLToPath(new URL('../NOTICE', import.meta.url));

const versionOf = (text) => /^#\s+Version:\s+(\S+)/m.exec(text)?.[1] ?? null;

async function load(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`${source} returned ${response.status}`);
    return response.text();
  }
  return readFile(source, 'utf8');
}

function check(text) {
  const problems = [];
  if (!/^#\s+List of PCI IDs/m.test(text)) problems.push('missing the "List of PCI IDs" header');
  if (!versionOf(text)) problems.push('missing a Version line');
  if (!/3-clause BSD License/.test(text)) problems.push('no longer mentions the 3-clause BSD License (see NOTICE)');
  // Vendor lines start in column 0 with four hex digits and two spaces.
  const vendors = text.split('\n').filter((line) => /^[0-9a-f]{4} {2}\S/.test(line)).length;
  if (vendors < 1000) problems.push(`only ${vendors} vendors, expected thousands`);
  return problems;
}

const source = process.argv[2] ?? DEFAULT_SOURCE;
const next = await load(source);
const problems = check(next);
if (problems.length > 0) {
  console.error(`Refusing ${source}:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

const current = await readFile(DATA, 'utf8');
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
if (next === current) {
  console.log(`pci.ids is already current (version ${versionOf(current)}).`);
  process.exit(0);
}

const notice = await readFile(NOTICE, 'utf8');
const pattern = /(PCI ID database \(\S+\), version )[\w.-]+(,)/;
if (!pattern.test(notice)) {
  console.error('NOTICE has no "PCI ID database ..., version X," line to update.');
  process.exit(1);
}

await writeFile(DATA, next);
await writeFile(NOTICE, notice.replace(pattern, `$1${versionOf(next)}$2`));
console.log(`pci.ids ${versionOf(current)} (${sha(current)}) -> ${versionOf(next)} (${sha(next)}); NOTICE updated.`);
