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

import type { NodeRow } from '@nodedash/shared';

/** Column ids (NodeRow keys) mapped to their header labels, in output order. */
export type CsvColumns = Record<string, string>;

// A cell a spreadsheet would evaluate as a formula. Node and instance names are
// user-controlled, so a name like `=HYPERLINK(...)` must not run when opened.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 CSV of the given rows: raw values (not the badge text), CRLF line endings. */
export function nodesToCsv(rows: NodeRow[], columns: CsvColumns): string {
  const ids = Object.keys(columns);
  const lines = [
    ids.map((id) => cell(columns[id])),
    ...rows.map((row) => ids.map((id) => cell(row[id as keyof NodeRow]))),
  ];
  return lines.map((line) => line.join(',')).join('\r\n') + '\r\n';
}

/** `nodes-<region>-<date>.csv`; the region is a Keystone id, so keep only filename-safe characters. */
export function csvFilename(region: string | null | undefined, now = new Date()): string {
  const safeRegion = region?.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|_+$/g, '');
  return ['nodes', safeRegion, now.toISOString().slice(0, 10)].filter(Boolean).join('-') + '.csv';
}

export function downloadCsv(filename: string, csv: string) {
  // The BOM makes Excel read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
