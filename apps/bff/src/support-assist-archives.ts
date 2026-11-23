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

import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { SUPPORT_ASSIST_ARCHIVE_NAME, type SupportAssistArchive } from '@nodedash/shared';
import type { Config } from './config.ts';
import { HttpError } from './errors.ts';

type ArchiveStore = Config['supportAssistArchives'][string];
// Idle timeouts: the directory listing is small, downloads can stall longer on a slow link.
const LIST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;
const MAX_INDEX_BYTES = 5_000_000;

const unavailable = () =>
  new HttpError(502, 'upstream_error', 'SupportAssist archive storage is unavailable.');

/** No redirects or browser-provided URLs; storage credentials stay on this connection. */
export function archiveResponse(store: ArchiveStore, uuid: string, name = ''): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const url = new URL(
      `${encodeURIComponent(uuid)}/${encodeURIComponent(name)}`,
      store.url.replace(/\/?$/, '/'),
    );
    const request = httpsRequest(
      url,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${store.username}:${store.password}`).toString('base64')}`,
        },
        timeout: name ? DOWNLOAD_TIMEOUT_MS : LIST_TIMEOUT_MS,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          reject(
            response.statusCode === 404
              ? new HttpError(404, 'not_found', 'Archive not found.')
              : unavailable(),
          );
        } else resolve(response);
      },
    );
    request.on('timeout', () => request.destroy(new Error('Archive storage timed out.')));
    request.on('error', () => reject(unavailable()));
    request.end();
  });
}

// NGINX autoindex JSON includes directories and file modification times in HTTP date format.
const IndexSchema = z.array(
  z.object({
    name: z.string(),
    type: z.string(),
    mtime: z.string(),
    size: z.number().int().nonnegative().optional(),
  }),
);

export async function listArchives(store: ArchiveStore, uuid: string): Promise<SupportAssistArchive[]> {
  try {
    const response = await archiveResponse(store, uuid);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > MAX_INDEX_BYTES) throw new Error('Archive index too large.');
      chunks.push(Buffer.from(chunk));
    }
    const entries = IndexSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return entries
      .flatMap((entry) => {
        const modified = new Date(entry.mtime);
        return entry.type === 'file' &&
          entry.size !== undefined &&
          !Number.isNaN(modified.getTime()) &&
          SUPPORT_ASSIST_ARCHIVE_NAME.test(entry.name)
          ? [{ name: entry.name, size: entry.size, modified: modified.toISOString() }]
          : [];
      })
      .sort((a, b) => b.modified.localeCompare(a.modified) || b.name.localeCompare(a.name));
  } catch (error) {
    // No collection has been uploaded for this node yet.
    if (error instanceof HttpError && error.status === 404) return [];
    throw unavailable();
  }
}
