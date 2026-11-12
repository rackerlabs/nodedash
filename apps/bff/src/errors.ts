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

import type { ApiErrorCode } from '@nodedash/shared';

/** Error shape the SPA understands; see ApiErrorSchema in @nodedash/shared. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly detail: string | null;

  constructor(status: number, code: ApiErrorCode, message: string, detail?: string | null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail ?? null;
  }
}

export const unauthenticated = () =>
  new HttpError(401, 'unauthenticated', 'Your session has expired. Sign in again.');

export const noScope = () =>
  new HttpError(409, 'no_scope', 'Select a domain and project before requesting node data.');

export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);

export const unsupported = (message: string) => new HttpError(406, 'unsupported', message);

/** Maps an upstream OpenStack status onto our own error vocabulary. */
export function fromUpstream(status: number, message: string, detail?: string | null): HttpError {
  if (status === 401) return unauthenticated();
  if (status === 403) return new HttpError(403, 'forbidden', message, detail);
  if (status === 404) return new HttpError(404, 'not_found', message, detail);
  if (status === 406) return new HttpError(406, 'unsupported', message, detail);
  if (status === 409) return new HttpError(409, 'conflict', message, detail);
  if (status === 400) return new HttpError(400, 'bad_request', message, detail);
  return new HttpError(502, 'upstream_error', message, detail);
}
